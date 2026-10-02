/**
 * Configuracion del entorno de pruebas.
 *
 * Las pruebas se ejecutan contra una base de datos PostgreSQL REAL y separada
 * (`escudo_vivo_test`). No se usan dobles de la base de datos: las
 * restricciones de unicidad, los indices parciales y las transacciones son
 * justamente lo que hay que comprobar, y un doble en memoria no las tiene.
 */
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL =
  process.env.TEST_DATABASE_URL ??
  'postgresql://marathon:marathon_dev_only@localhost:5434/escudo_vivo_test?schema=public';

// Valores de prueba deterministas: asi los hashes son reproducibles entre suites.
process.env.SESSION_SECRET = 'test-session-secret-0123456789abcdefghijklmnop';
process.env.TOKEN_HASH_PEPPER = 'test-token-pepper-0123456789abcdefghijklmnop';
process.env.ANALYTICS_IP_SALT = 'test-analytics-salt-0123456789ab';
process.env.NFC_PROVIDER = 'mock';
process.env.FAN_WEB_PUBLIC_URL = 'http://localhost:3000';
process.env.ADMIN_WEB_PUBLIC_URL = 'http://localhost:3001';
// Limites altos para que las pruebas no choquen con el rate limiting salvo
// cuando lo comprueban a proposito.
process.env.RATE_LIMIT_VERIFY_PER_MINUTE = '1000';
process.env.RATE_LIMIT_LOGIN_PER_MINUTE = '1000';
process.env.RATE_LIMIT_FAN_WRITE_PER_HOUR = '1000';
process.env.RATE_LIMIT_PUBLIC_FORMS_PER_HOUR = '1000';
