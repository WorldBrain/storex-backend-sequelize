import { testStorageBackend } from "storex/lib/index.tests"
import { SequelizeStorageBackend } from "."

describe('Sequelize StorageBackend integration tests', () => {
    testStorageBackend(async () => {
        return new SequelizeStorageBackend({sequelizeConfig: 'sqlite://'})
    })
})
