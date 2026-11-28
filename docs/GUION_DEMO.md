# Guion de demostración · Control Académico Saint Mary's

**Duración:** ~8 minutos · **Formato:** grabación de pantalla con voz.
**Cada bloque tiene dos partes:** 🖱️ *qué hacer en pantalla* y 🎙️ *qué decir*.

## Antes de grabar

1. Terminal: `npm start` → debe decir `Datos: Cloud Firestore · Push FCM: activo`.
2. Abre **dos ventanas del navegador** lado a lado (la segunda en modo incógnito, para tener dos sesiones a la vez):
   - Ventana A: <http://localhost:3000> (docente y Dirección).
   - Ventana B: <http://localhost:3000> en incógnito, con tamaño de **celular** (F12 → modo dispositivo, o ventana angosta) para el apoderado.
3. Contraseña de todas las cuentas: `colegio2026`.
4. Para el push: en la ventana B entra como `rquispe`, ve a **Avisos → Activar** y acepta el permiso **antes** de grabar.
5. Cierra pestañas y notificaciones ajenas. Zoom del navegador al 100 %–110 %.

| Perfil | Usuario | Se usa para |
| --- | --- | --- |
| Docente | `rhuaman` | Asistencia, notas, conducta, mensajes |
| Dirección | `vgallardo` | Estudiantes, consentimientos, reportes |
| Apoderado | `rquispe` | Ver avisos, notas y mensajes de Mateo |
| Apoderado (1.er ingreso) | `jnavarro` | Mostrar el consentimiento |

---

## 1 · Presentación (0:00 – 0:40)

🖱️ Pantalla de inicio de sesión.

🎙️ «Hola, les presento el **Sistema de Control Académico del College Saint Mary's**. Resuelve un problema concreto: hoy la asistencia, las notas y la conducta se anotan en actas físicas y los padres se enteran tarde. Con este sistema el docente registra una sola vez y el apoderado recibe el aviso **el mismo día**, en su celular. Hay tres perfiles: docente, dirección y apoderado. Los datos viven en la nube con **Firebase Firestore** y los avisos al celular usan **Firebase Cloud Messaging**, todo en planes gratuitos.»

## 2 · Consentimiento del apoderado (0:40 – 1:30)

🖱️ Ventana B: elige **Apoderado** → usuario `jnavarro` → entrar. Se muestra el consentimiento. Marca la autorización de datos y la de notificaciones → **Aceptar**.

🎙️ «Empezamos por el apoderado, porque la ley manda. Don Jorge Navarro entra por primera vez y **no ve nada** hasta aceptar el tratamiento de los datos de su hijo, según la Ley 29733. Puede además autorizar las notificaciones. Se guarda la fecha de aceptación, y **sin este consentimiento el sistema no envía avisos**.»

🖱️ Cierra sesión.

## 3 · Docente: asistencia (1:30 – 3:00)

🖱️ Ventana A: **Docente** → `rhuaman`. Muestra el **Inicio**, luego **Asistencia**. Elige la sección *1.° Secundaria – Única*, la fecha de hoy. Marca **Falta injustificada** a un estudiante (por ejemplo Mateo Alvarado) → **Guardar**.

🎙️ «La profesora Rosa Huamán es tutora de 1.° de secundaria. Entra a **Asistencia**: la lista de su sección carga sola. Marca asistió, tardanza o falta y guarda **en una sola acción**. Registrar una sección completa toma menos de tres minutos. Fíjense en el resultado: el sistema informa **cuántos avisos se enviaron**. Si guardo otra vez sin cambios, no duplica notificaciones.»

🖱️ Cambia a la ventana B (celular), entra como `rquispe`: llega la **notificación push** y en **Avisos** aparece «Falta injustificada».

🎙️ «Y aquí está lo importante: la mamá de Mateo recibe la notificación **en su celular**, aunque no tenga la página abierta, y también queda como aviso dentro de la plataforma.»

## 4 · Docente: notas (3:00 – 4:00)

🖱️ Ventana A: **Notas** → curso *Matemática*, bimestre **IV**. Escribe una nota en una celda (ej. 15). Intenta poner `21` para mostrar el error. Guarda como borrador; luego **Publicar**.

🎙️ «En **Notas** se elige curso y bimestre y se ingresa la nota por competencia, en escala de 0 a 20. Si escribo 21, el sistema lo rechaza. El promedio del curso se calcula solo. Mientras sea un **borrador**, el apoderado no lo ve; al **publicar**, se le notifica.»

## 5 · Docente: conducta y mensajes (4:00 – 5:00)

🖱️ **Conducta** → nuevo registro: estudiante, tipo *leve*, descripción → guardar. Luego **Mensajes**: abre una conversación y escribe un mensaje. Muestra el botón **WhatsApp**.

🎙️ «Las incidencias de conducta —leve, moderada o grave— también se avisan al apoderado. En **Mensajes** la docente conversa directamente con cada apoderado, sin esperar la reunión bimestral. Y si prefiere WhatsApp, este botón abre el chat con un clic; es un enlace gratuito, sin costo de API.»

## 6 · Apoderado: su vista (5:00 – 6:00)

🖱️ Ventana B (`rquispe`): recorre **Inicio** (promedio, asistencia, conducta), **Notas** (por curso y competencia), **Avisos** y **Mensajes** (responde al docente).

🎙️ «Así lo ve el apoderado, desde el celular. En el **resumen**: el promedio, el porcentaje de asistencia y la conducta de su hijo. En **Notas**, el detalle por curso y competencia. En **Avisos**, todo lo que ocurrió, y en **Mensajes** puede responder. Solo ve la información de **su** hijo.»

## 7 · Dirección: administración (6:00 – 7:00)

🖱️ Ventana A: cierra sesión → **Dirección** → `vgallardo`. Muestra **Estudiantes y apoderados** (busca por DNI o nombre). Pulsa **Nuevo estudiante** y regístralo; muestra la contraseña temporal. Luego **Consentimientos**, **Docentes** y **Cursos y secciones**.

🎙️ «La dirección administra todo. En **Estudiantes** se registra un alumno con su DNI —que no puede repetirse— y su apoderado; el sistema crea el usuario y muestra una **contraseña temporal una sola vez**. Los estudiantes no se eliminan, se desactivan, para conservar el historial. En **Consentimientos** vemos quién ya autorizó y quién está pendiente.»

## 8 · Dirección: reportes (7:00 – 8:00)

🖱️ **Reportes** → bimestre IV. Señala promedio general, asistencia, **estudiantes en riesgo** (Diego Chávez y Gael Soto) y el comparativo por curso. Pulsa **Exportar Excel** y **Exportar PDF**.

🎙️ «Los reportes dan el panorama del bimestre: promedio general, asistencia y el comparativo por curso. Aquí aparecen los **estudiantes en riesgo**: los que tienen promedio menor a 11 o más de tres faltas injustificadas, para intervenir a tiempo. Todo se exporta a **Excel** y **PDF**.»

## 9 · Cierre (8:00 – 8:30)

🎙️ «En resumen: registro rápido para el docente, aviso inmediato al apoderado, cumplimiento de la ley de protección de datos y reportes para decidir, todo funcionando en la nube **sin costo**. Gracias.»

---

## Si algo falla durante la grabación

| Problema | Solución |
| --- | --- |
| No llega el push | Revisa que el permiso del navegador no esté bloqueado y que el apoderado haya aceptado notificaciones. Muestra el aviso en **Avisos** como respaldo |
| «Demasiados intentos» al iniciar sesión | Espera unos minutos o reinicia `npm start` |
| Datos desordenados tras varias pruebas | `npm run seed -- --reset` (borra todo y vuelve a cargar la demostración) |
