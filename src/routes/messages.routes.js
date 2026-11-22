const express = require('express');
const auth = require('../auth');
const { HttpError, toIsoDateTime } = require('../util');
const { accessibleSections, assertSectionAccess, ensureConversation, notifyGuardian, parseId } = require('../domain');

const MAX_BODY = 2000;

module.exports = function messagesRoutes(db) {
  const router = express.Router();
  router.use(auth.requireAuth);

  /** Resuelve el apoderado de la conversación según el rol del usuario. */
  function resolveGuardian(req) {
    if (req.user.role === 'apoderado') {
      if (!req.guardian?.consentAcceptedAt) throw new HttpError(403, 'Debes aceptar el consentimiento para continuar.');
      return db.prepare('SELECT id, student_id FROM guardians WHERE id = ?').get(req.guardian.id);
    }
    const guardianId = parseId(req.params.guardianId, 'apoderado');
    const guardian = db.prepare('SELECT id, student_id FROM guardians WHERE id = ?').get(guardianId);
    if (!guardian) throw new HttpError(404, 'Apoderado no encontrado.');
    const student = db.prepare('SELECT section_id FROM students WHERE id = ?').get(guardian.student_id);
    assertSectionAccess(db, req.user, student.section_id);
    return guardian;
  }

  router.get('/conversations', (req, res) => {
    const unreadFor = (convAlias) =>
      `(SELECT COUNT(*) FROM messages m WHERE m.conversation_id = ${convAlias}.id AND m.kind = 'text'
         AND m.read_at IS NULL AND m.sender_id <> ?)`;
    const lastMessage = (field) =>
      `(SELECT m.${field} FROM messages m WHERE m.conversation_id = c.id AND m.kind = 'text' ORDER BY m.created_at DESC, m.id DESC LIMIT 1)`;

    if (req.user.role === 'apoderado') {
      if (!req.guardian?.consentAcceptedAt) throw new HttpError(403, 'Debes aceptar el consentimiento para continuar.');
      ensureConversation(db, req.guardian.id);
      const row = db
        .prepare(`
          SELECT c.id, u.full_name AS teacherName, ${lastMessage('body')} AS lastBody,
                 ${lastMessage('created_at')} AS lastAt, ${unreadFor('c')} AS unread
          FROM conversations c JOIN users u ON u.id = c.teacher_id WHERE c.guardian_id = ?`)
        .get(req.user.id, req.guardian.id);
      return res.json({ conversations: row ? [row] : [] });
    }

    const sectionIds = accessibleSections(db, req.user).map((s) => s.id);
    if (!sectionIds.length) return res.json({ conversations: [] });
    const guardians = db
      .prepare(`
        SELECT g.id AS guardianId, g.full_name AS guardianName, s.last_names, s.first_names
        FROM guardians g JOIN students s ON s.id = g.student_id
        WHERE s.active = 1 AND s.section_id IN (${sectionIds.map(() => '?').join(',')})`)
      .all(...sectionIds);

    const conversations = guardians.map((g) => {
      const convId = ensureConversation(db, g.guardianId);
      const stats = convId
        ? db
            .prepare(`
              SELECT ${lastMessage('body')} AS lastBody, ${lastMessage('created_at')} AS lastAt, ${unreadFor('c')} AS unread
              FROM conversations c WHERE c.id = ?`)
            .get(req.user.id, convId)
        : { lastBody: null, lastAt: null, unread: 0 };
      return {
        guardianId: g.guardianId,
        guardianName: g.guardianName,
        studentName: `${g.first_names} ${g.last_names}`,
        lastBody: stats.lastBody,
        lastAt: stats.lastAt,
        unread: stats.unread,
      };
    });
    conversations.sort((a, b) => (b.lastAt || '').localeCompare(a.lastAt || '') || a.guardianName.localeCompare(b.guardianName));
    res.json({ conversations });
  });

  function conversationView(req, guardian) {
    const conversationId = ensureConversation(db, guardian.id);
    const student = db.prepare('SELECT last_names, first_names, section_id FROM students WHERE id = ?').get(guardian.student_id);
    const section = db.prepare('SELECT name FROM sections WHERE id = ?').get(student.section_id);
    const info = db.prepare('SELECT full_name AS guardianName, phone FROM guardians WHERE id = ?').get(guardian.id);
    return { conversationId, student, section, info };
  }

  router.get('/conversations/:guardianId/messages', (req, res) => {
    const guardian = resolveGuardian(req);
    const { conversationId, student, section, info } = conversationView(req, guardian);
    if (!conversationId) throw new HttpError(409, 'La sección no tiene tutor asignado.');
    const mine = req.user.id;
    db.prepare(`
      UPDATE messages SET read_at = ?
      WHERE conversation_id = ? AND kind = 'text' AND read_at IS NULL AND sender_id <> ?`).run(
      toIsoDateTime(new Date()),
      conversationId,
      mine,
    );
    const messages = db
      .prepare(`
        SELECT m.id, m.kind, m.body, m.created_at AS createdAt, m.read_at AS readAt, m.sender_id AS senderId,
               u.full_name AS senderName, u.role AS senderRole
        FROM messages m LEFT JOIN users u ON u.id = m.sender_id
        WHERE m.conversation_id = ? ORDER BY m.created_at, m.id`)
      .all(conversationId);
    res.json({
      guardian: { id: guardian.id, name: info.guardianName, phone: info.phone },
      student: { fullName: `${student.first_names} ${student.last_names}`, sectionName: section.name },
      messages: messages.map((m) => ({
        id: m.id,
        kind: m.kind,
        body: m.body,
        createdAt: m.createdAt,
        readAt: m.readAt,
        mine: m.senderId === mine,
        senderName: m.senderName,
        senderRole: m.senderRole,
      })),
    });
  });

  router.post('/conversations/:guardianId/messages', (req, res) => {
    const guardian = resolveGuardian(req);
    const body = typeof req.body?.body === 'string' ? req.body.body.trim() : '';
    if (!body) throw new HttpError(400, 'Escribe un mensaje.');
    if (body.length > MAX_BODY) throw new HttpError(400, `El mensaje no puede superar los ${MAX_BODY} caracteres.`);
    const conversationId = ensureConversation(db, guardian.id);
    if (!conversationId) throw new HttpError(409, 'La sección no tiene tutor asignado.');

    const now = toIsoDateTime(new Date());
    const id = db
      .prepare("INSERT INTO messages (conversation_id, sender_id, kind, body, created_at) VALUES (?, ?, 'text', ?, ?)")
      .run(conversationId, req.user.id, body, now).lastInsertRowid;

    let notified = false;
    if (req.user.role !== 'apoderado') {
      const preview = body.length > 140 ? `${body.slice(0, 137)}…` : body;
      notified = notifyGuardian(db, guardian.student_id, {
        kind: 'mensaje',
        title: `Mensaje de ${req.user.fullName}`,
        body: preview,
      }).sent;
    }
    res.status(201).json({ id, createdAt: now, notified });
  });

  router.get('/badges', (req, res) => {
    if (req.user.role === 'apoderado') {
      if (!req.guardian?.consentAcceptedAt) return res.json({ messages: 0, notifications: 0 });
      const notifications = db
        .prepare('SELECT COUNT(*) AS n FROM notifications WHERE guardian_id = ? AND read_at IS NULL')
        .get(req.guardian.id).n;
      const messages = db
        .prepare(`
          SELECT COUNT(*) AS n FROM messages m JOIN conversations c ON c.id = m.conversation_id
          WHERE c.guardian_id = ? AND m.kind = 'text' AND m.read_at IS NULL AND m.sender_id <> ?`)
        .get(req.guardian.id, req.user.id).n;
      return res.json({ messages, notifications });
    }
    const sectionIds = accessibleSections(db, req.user).map((s) => s.id);
    if (!sectionIds.length) return res.json({ messages: 0, notifications: 0 });
    const messages = db
      .prepare(`
        SELECT COUNT(*) AS n FROM messages m
        JOIN conversations c ON c.id = m.conversation_id
        JOIN guardians g ON g.id = c.guardian_id
        JOIN students s ON s.id = g.student_id
        WHERE m.kind = 'text' AND m.read_at IS NULL AND m.sender_id <> ?
          AND s.section_id IN (${sectionIds.map(() => '?').join(',')})`)
      .get(req.user.id, ...sectionIds).n;
    res.json({ messages, notifications: 0 });
  });

  return router;
};
