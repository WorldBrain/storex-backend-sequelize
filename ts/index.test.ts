import * as expect from 'expect';
import StorageManager from "storex";
import { testStorageBackend } from "storex/lib/index.tests"
import { SequelizeStorageBackend } from "."

async function initSimpleTest(sequelize = null) {
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

describe('Sequelize StorageBackend integration tests', () => {
    testStorageBackend(async () => {
        return new SequelizeStorageBackend({sequelizeConfig: 'sqlite://'})
    })
})

describe('Sequelize-specific tests', () => {
    it('should allow re-using the same Sequelize instance multiple times', async () => {
        const storageManager1 = await initSimpleTest()
        await storageManager1.backend.migrate()
        await storageManager1.collection('user').createObject({identifier: 'joe'})
        expect(await storageManager1.collection('user').findOneObject({identifier: 'joe'})).toEqual({id: 1, identifier: 'joe'})

        const storageManager2 = await initSimpleTest((storageManager1.backend as SequelizeStorageBackend).sequelize)
        expect(await storageManager2.collection('user').findOneObject({identifier: 'joe'})).toEqual({id: 1, identifier: 'joe'})
    })
})

describe('Sequelize transaction tests', () => {
    it('should commit a transaction on success', async () => {
        const storageManager = await initSimpleTest()
        await storageManager.backend.migrate()
        await storageManager.backend.operation('transaction', {collections: ['user']}, async ({transactionOperation}) => {
            await transactionOperation('createObject', 'user', {identifier: 'joe'})
        })
        expect(await storageManager.collection('user').findOneObject({identifier: 'joe'})).toEqual({id: 1, identifier: 'joe'})
    })

    it('should correctly roll back a transaction on fail', async () => {
        const storageManager = await initSimpleTest()
        await storageManager.backend.migrate()
        const errMsg = `One flew over the cuckoo's nest`
        try {
            await storageManager.backend.operation('transaction', {collections: ['user']}, async ({transactionOperation}) => {
                await transactionOperation('createObject', 'user', {identifier: 'joe'})
                throw new Error(errMsg)
            })
        } catch (err) {
            if (err.message !== errMsg) {
                throw err
            }
        }
        expect(await storageManager.collection('user').findOneObject({identifier: 'joe'})).toEqual(null)
    })
})
