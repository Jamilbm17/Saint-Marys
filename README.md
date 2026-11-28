# Sistema de Control Académico · College Saint Mary's

Aplicación web para registrar **asistencia, notas y conducta** y avisar a los apoderados el mismo día.
Implementa las pantallas del diseño (10 capturas) con datos de demostración ficticios sobre **Cloud Firestore** (o memoria para probar sin cuenta).

## Perfiles y pantallas

| Perfil | Pantallas |
| --- | --- |
| Acceso | Inicio de sesión por perfil · Consentimiento del apoderado (primer ingreso, Ley N.° 29733) |
| Docente | Inicio · Asistencia · Notas · Conducta · Mensajes |
| Dirección | Inicio · Estudiantes y apoderados · Docentes · Cursos y secciones · Consentimientos · Reportes (Excel y PDF) |
| Apoderado (móvil) | Resumen · Notas por curso · Notificaciones · Mensajes |

## Requisitos

- Node.js 20 o superior

## Puesta en marcha

```bash
npm install
npm start
```

Abre <http://localhost:3000>. **Sin credenciales de Firebase** la app usa un almacén en memoria con los datos de
demostración (se pierden al reiniciar). Para usar Firestore y las notificaciones push sigue
las variables de `.env.example` (copia a `.env`): cuenta de servicio de Firestore y configuración web/VAPID de FCM.

```bash
npm run seed -- --reset   # borra Firestore y carga los datos de demostración
npm run seed:bulk         # suma 4 secciones x 30 estudiantes (`--sections`, `--students`, `--terms`; estima las escrituras: el plan gratuito permite 20 000/día)
npm test                  # pruebas de la API (memoria; contra Firestore si FIRESTORE_EMULATOR_HOST está definido)
```

### Cuentas de demostración

La contraseña común de todas las cuentas está en `DEMO_PASSWORD` (`src/seed.js`). **Cámbiala antes de publicar la app.**

| Perfil | Usuario | Notas |
| --- | --- | --- |
| Docente (tutora) | `rhuaman` | Prof. Rosa Huamán · Matemática |
| Dirección | `vgallardo` | Lic. Virginia Gallardo |
| Apoderado | `jnavarro` | Jorge Navarro · verá primero el consentimiento |
| Apoderado | `lchavez`, `mvillanueva`, `rmendoza`… | Un apoderado por estudiante (ver `src/seed.js`) |

Los datos de ejemplo se calculan a partir del último día hábil, así que siempre hay una asistencia "de hoy",
avisos y mensajes. Reproducen las capturas: 14 estudiantes de 1.° Secundaria, 8 cursos, Diego Chávez
y Gael Soto en riesgo, Joaquín Navarro con tardanza hoy, etc.

## Cómo funciona

- **Asistencia**: al guardar, cada tardanza o falta *nueva* genera una notificación al apoderado y un aviso
  automático en su conversación. Guardar otra vez sin cambios no duplica avisos.
- **Notas**: escala 0–20 por competencia; el promedio del curso es la media redondeada. Los borradores no son
  visibles para los apoderados; al publicar se notifica. Estudiante en riesgo: promedio < 11.
- **Conducta**: cada incidencia (leve, moderada, grave) se notifica al apoderado. La calificación de conducta
  del resumen es A (sin incidencias), B (1–2 leves) o C (3 leves o alguna moderada/grave).
- **Consentimiento**: sin aceptar el tratamiento de datos, el apoderado no ve información ni recibe
  notificaciones. Se guarda la fecha de aceptación.
- **Estudiantes**: DNI único (8 dígitos). Al registrar un estudiante se crea el usuario del apoderado con una
  contraseña temporal que se muestra una sola vez. Los estudiantes **no se eliminan**: se activan/desactivan
  y se conserva su historial.
- **Notificaciones push**: además del aviso en la plataforma, el apoderado puede activar notificaciones en su celular
  (Firebase Cloud Messaging) desde *Avisos*. Solo se envían con consentimiento y notificaciones activadas.
- **WhatsApp**: el informe descarta la API comercial de WhatsApp (decisión CC04, por costo). Se incluye solo un enlace
  gratuito «click to chat» (`wa.me`) para que docentes y Dirección abran WhatsApp con el apoderado manualmente.
- **Reportes**: promedios, asistencia por bimestre, notificaciones y estudiantes en riesgo (promedio < 11 o
  más de 3 faltas injustificadas). "Exportar Excel" genera un `.xlsx`; "Exportar PDF" usa la impresión del
  navegador (Guardar como PDF).

## Estructura

```
server.js            arranque (abre el almacén; en memoria carga la demostración)
src/
  app.js             Express: cabeceras de seguridad, rutas, errores
  store/             almacén de datos: firestore.js (producción) y memory.js (pruebas/local)
  firebase.js, push.js  firebase-admin y notificaciones FCM
  seed.js, seed-bulk.js datos de demostración y carga masiva
  auth.js            contraseñas (scrypt), sesiones, roles, consentimiento
  domain.js          reglas compartidas (permisos por sección, notificaciones, indicadores)
  routes/            auth, attendance, grades, conduct, messages, guardian, admin, reports
public/              interfaz (HTML + CSS + JS sin build): js/views/{auth,teacher,director,guardian}.js
test/api.test.js     pruebas de la API
```

## Seguridad

- Contraseñas con `scrypt` y sesiones con token aleatorio guardado como hash; cookie `HttpOnly` + `SameSite=Lax`
  (con `NODE_ENV=production` también `Secure`: úsalo detrás de HTTPS).
- Autorización en el servidor por rol y por sección/curso asignado; el apoderado solo accede a su hijo.
- Consultas parametrizadas, escape de HTML en la interfaz, CSP restrictiva y límite de intentos de inicio de sesión.

## Alcance actual y pendientes

- Las notificaciones se entregan dentro de la plataforma y por **push (FCM)** cuando está configurado. No hay
  correo ni API de WhatsApp (fuera del alcance del informe).
- Autenticación propia (usuario + contraseña, sesiones en Firestore); no se usa Firebase Authentication.
- Docentes y cursos/secciones son de **solo lectura** en Dirección (se cargan desde `src/seed.js`).
- Un apoderado por estudiante.
- Sin recuperación de contraseña por correo: Dirección restablece la contraseña desde *Estudiantes*.
