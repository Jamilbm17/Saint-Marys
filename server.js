const config = require('./src/config');
const { openDatabase } = require('./src/db');
const { createApp } = require('./src/app');

const db = openDatabase();

if (db.prepare('SELECT COUNT(*) AS n FROM users').get().n === 0) {
  console.log('Base de datos vacía: cargando datos de demostración…');
  require('./src/seed').seed(db);
}

createApp(db).listen(config.port, () => {
  console.log(`Saint Mary's · Control Académico en http://localhost:${config.port}`);
});
