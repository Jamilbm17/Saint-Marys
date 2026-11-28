/* Service worker de Firebase Cloud Messaging: muestra las notificaciones push con la app cerrada.
 * La configuración pública de Firebase llega por la query string con la que se registra este archivo. */
importScripts('https://www.gstatic.com/firebasejs/10.14.1/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.14.1/firebase-messaging-compat.js');

const params = new URL(self.location.href).searchParams;
firebase.initializeApp({
  apiKey: params.get('apiKey'),
  projectId: params.get('projectId'),
  messagingSenderId: params.get('messagingSenderId'),
  appId: params.get('appId'),
});

// Con cargas `notification`, el SDK muestra la notificación en segundo plano y abre `fcmOptions.link` al tocarla.
firebase.messaging();
