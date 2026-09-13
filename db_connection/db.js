const pg = require('pg');

const pool = new pg.Pool({
    host: process.env.host,
    port: 5432,
    database: process.env.db,
    user: process.env.user,
    password: process.env.password
})


module.exports = pool;