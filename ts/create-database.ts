const { Pool } = require('pg')

export async function createPostgresDatabaseIfNecessary(
    { host = null, port = null, username : user = null, password = null, database }
) {
    const pool = new Pool({ host, port, user, password, database: 'postgres' })

    let created
    try {
        await pool.query(`CREATE DATABASE ${database}`)
        created = true
    } catch (err) {
        created = false
    }

    pool.end()
    return created
}
