const config = require('./src/config');
const { openStore } = require('./src/store');
const { createApp } = require('./src/app');
const { pushEnabled } = require('./src/push');

async function main() {
  const store = openStore();
  const empty = !(await store.findOne('users', { role: 'direccion' }));

  if (store.kind === 'memory') {
    console.log('Sin credenciales de Firebase: usando almacén en memoria con datos de demostración (se pierden al reiniciar).');
    await require('./src/seed').seed(store);
  } else if (empty && process.env.AUTO_SEED === 'true') {
    console.log('Firestore vacío y AUTO_SEED=true: cargando datos de demostración…');
    await require('./src/seed').seed(store);
  } else if (empty) {
    console.log('Aviso: Firestore está vacío. Ejecuta "npm run seed" para cargar los datos de demostración.');
  }

  createApp(store).listen(config.port, () => {
    console.log(`Saint Mary's · Control Académico en http://localhost:${config.port}`);
    console.log(`  Datos: ${store.kind === 'firestore' ? 'Cloud Firestore' : 'memoria'} · Push FCM: ${pushEnabled() ? 'activo' : 'desactivado'}`);
  });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
