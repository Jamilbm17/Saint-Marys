const express = require('express');
const auth = require('../auth');
const { HttpError, toIsoDateTime } = require('../util');
const { accessibleSections, assertSectionAccess, ensureConversation, notifyGuardian, appendMessage, parseId } = require('../domain');

const MAX_BODY = 2000;

module.exports = function messagesRoutes(store) {
  const router = express.Router();
  router.use(auth.requireAuth);

  /** Resuelve el apoderado de la conversación según el rol del usuario. */
  async function resolveGuardian(req) {
    if (req.user.role === 'apoderado') {
      if (!req.guardian?.consentAcceptedAt) throw new HttpError(403, 'Debes aceptar el consentimiento para continuar.');
      return store.get('guardians', req.guardian.id);
    }
    const guardianId = parseId(req.params.guardianId, 'apoderado');
    const guardian = await store.get('guardians', guardianId);
    if (!guardian) throw new HttpError(404, 'Apoderado no encontrado.');
    const student = await store.get('students', guardian.student_id);
    await assertSectionAccess(store, req.user, student.section_id);
    return guardian;
  }

  router.get('/conversations', async (req, res) => {
    if (req.user.role === 'apoderado') {
      if (!req.guardian?.consentAcceptedAt) throw new HttpError(403, 'Debes aceptar el consentimiento para continuar.');
      const id = await ensureConversation(store, req.guardian.id);
      const conversation = id && (await store.get('conversations', id));
      if (!conversation) return res.json({ conversations: [] });
      const teacher = await store.get('users', conversation.teacher_id);
      return res.json({
        conversations: [
          {
            id: conversation.id,
            teacherName: teacher.full_name,
            lastBody: conversation.last_body,
            lastAt: conversation.last_at,
            unread: conversation.unread_guardian || 0,
          },
        ],
      });
    }

    const sectionIds = (await accessibleSections(store, req.user)).map((s) => s.id);
    if (!sectionIds.length) return res.json({ conversations: [] });
    const students = await store.findIn('students', 'section_id', sectionIds, { active: true });
    const guardians = await store.findIn('guardians', 'student_id', students.map((s) => s.id));
    const existing = new Map((await store.findIn('conversations', 'guardian_id', guardians.map((g) => g.id))).map((c) => [c.guardian_id, c]));
    const studentById = new Map(students.map((s) => [s.id, s]));

    const conversations = [];
    for (const g of guardians) {
      let conversation = existing.get(g.id);
      if (!conversation) {
        const id = await ensureConversation(store, g.id);
        conversation = id ? await store.get('conversations', id) : null;
      }
      const student = studentById.get(g.student_id);
      conversations.push({
        guardianId: g.id,
        guardianName: g.full_name,
        studentName: `${student.first_names} ${student.last_names}`,
        lastBody: conversation?.last_body ?? null,
        lastAt: conversation?.last_at ?? null,
        unread: conversation?.unread_staff || 0,
      });
    }
    conversations.sort((a, b) => (b.lastAt || '').localeCompare(a.lastAt || '') || a.guardianName.localeCompare(b.guardianName, 'es'));
    res.json({ conversations });
  });

  router.get('/conversations/:guardianId/messages', async (req, res) => {
    const guardian = await resolveGuardian(req);
    const conversationId = await ensureConversation(store, guardian.id);
    if (!conversationId) throw new HttpError(409, 'La sección no tiene tutor asignado.');
    const student = await store.get('students', guardian.student_id);
    const section = await store.get('sections', student.section_id);

    const isGuardian = req.user.role === 'apoderado';
    const all = (await store.find('messages', { where: { conversation_id: conversationId } })).sort(
      (a, b) => a.created_at.localeCompare(b.created_at) || a.id - b.id,
    );
    // Se marcan como leídos los mensajes del "otro lado" de la conversación.
    const incoming = (m) => m.kind === 'text' && (isGuardian ? m.sender_id !== guardian.user_id : m.sender_id === guardian.user_id);
    const unread = all.filter((m) => incoming(m) && !m.read_at);
    if (unread.length) {
      const stamp = toIsoDateTime(new Date());
      await store.commit(unread.map((m) => ({ type: 'update', col: 'messages', id: m.id, data: { read_at: stamp } })));
      await store.update('conversations', conversationId, isGuardian ? { unread_guardian: 0 } : { unread_staff: 0 });
    }

    const senders = new Map((await store.getMany('users', all.map((m) => m.sender_id).filter(Boolean))).map((u) => [u.id, u]));
    const mine = req.user.id;
    res.json({
      guardian: { id: guardian.id, name: guardian.full_name, phone: guardian.phone },
      student: { fullName: `${student.first_names} ${student.last_names}`, sectionName: section.name },
      messages: all.map((m) => ({
        id: m.id,
        kind: m.kind,
        body: m.body,
        createdAt: m.created_at,
        readAt: m.read_at ?? null,
        mine: m.sender_id === mine,
        senderName: senders.get(m.sender_id)?.full_name ?? null,
        senderRole: senders.get(m.sender_id)?.role ?? null,
      })),
    });
  });

  router.post('/conversations/:guardianId/messages', async (req, res) => {
    const guardian = await resolveGuardian(req);
    const body = typeof req.body?.body === 'string' ? req.body.body.trim() : '';
    if (!body) throw new HttpError(400, 'Escribe un mensaje.');
    if (body.length > MAX_BODY) throw new HttpError(400, `El mensaje no puede superar los ${MAX_BODY} caracteres.`);
    const conversationId = await ensureConversation(store, guardian.id);
    if (!conversationId) throw new HttpError(409, 'La sección no tiene tutor asignado.');

    const fromGuardian = req.user.role === 'apoderado';
    const { id, createdAt } = await appendMessage(store, conversationId, { senderId: req.user.id, body, fromGuardian });

    let notified = false;
    if (!fromGuardian) {
      const preview = body.length > 140 ? `${body.slice(0, 137)}…` : body;
      notified = (
        await notifyGuardian(store, guardian.student_id, { kind: 'mensaje', title: `Mensaje de ${req.user.fullName}`, body: preview })
      ).sent;
    }
    res.status(201).json({ id, createdAt, notified });
  });

  router.get('/badges', async (req, res) => {
    if (req.user.role === 'apoderado') {
      if (!req.guardian?.consentAcceptedAt) return res.json({ messages: 0, notifications: 0 });
      const [unreadNotifications, conversation] = await Promise.all([
        store.find('notifications', { where: { guardian_id: req.guardian.id, read_at: null } }),
        store.findOne('conversations', { guardian_id: req.guardian.id }),
      ]);
      return res.json({ messages: conversation?.unread_guardian || 0, notifications: unreadNotifications.length });
    }
    const sectionIds = new Set((await accessibleSections(store, req.user)).map((s) => s.id));
    if (!sectionIds.size) return res.json({ messages: 0, notifications: 0 });
    const pending = await store.find('conversations', { range: { field: 'unread_staff', gt: 0 } });
    const guardians = await store.getMany('guardians', pending.map((c) => c.guardian_id));
    const students = new Map((await store.getMany('students', guardians.map((g) => g.student_id))).map((s) => [s.id, s]));
    const guardianById = new Map(guardians.map((g) => [g.id, g]));
    const messages = pending
      .filter((c) => sectionIds.has(students.get(guardianById.get(c.guardian_id)?.student_id)?.section_id))
      .reduce((sum, c) => sum + c.unread_staff, 0);
    res.json({ messages, notifications: 0 });
  });

  return router;
};
