import * as expect from 'expect';
import StorageManager from "storex";
import { testStorageBackend } from "storex/lib/index.tests"
import { SequelizeStorageBackend } from "."

describe('Sequelize StorageBackend integration tests', () => {
    testStorageBackend(async () => {
        return new SequelizeStorageBackend({sequelizeConfig: 'sqlite://'})
    })
})

describe('Sequelize-specific tests', () => {
    it('should allow re-using the same Sequelize instance multiple times', async () => {
        const init = async (sequelize = null) => {
            const backend = new SequelizeStorageBackend({sequelizeConfig: 'sqlite://', sequelize})
            const storageManager = new StorageManager({ backend })
            storageManager.registry.registerCollections({
                user: {
                    version: new Date(2018, 7, 31),
                    fields: {
                        identifier: { type: 'string' },
                    },
                    indices: []
                },
            })
            await storageManager.finishInitialization()
            return storageManager
        }

        const storageManager1 = await init()
        await storageManager1.backend.migrate()
        await storageManager1.collection('user').createObject({identifier: 'joe'})
        expect(await storageManager1.collection('user').findOneObject({identifier: 'joe'})).toEqual({id: 1, identifier: 'joe'})

        const storageManager2 = await init((storageManager1.backend as SequelizeStorageBackend).sequelize)
        expect(await storageManager2.collection('user').findOneObject({identifier: 'joe'})).toEqual({id: 1, identifier: 'joe'})
    })
})
