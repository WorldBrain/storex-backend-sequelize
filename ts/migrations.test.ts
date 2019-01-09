import * as expect from 'expect';
import * as Sequelize from 'sequelize'
import StorageManager, { CollectionDefinition } from "storex";
import { SequelizeStorageBackend } from ".";

describe('Sequelize migration tests', () => {
    let migrations, schemaEditor
    try {
        migrations = require('@worldbrain-io/storex-schema-migrations')
        schemaEditor = require('@worldbrain-io/storex-backend-sequelize-schema-editor')
    } catch (err) {
        migrations = schemaEditor = null
        console.warn(`Couldn't find required dependencies for Sequelize migration tests, so skipping them`, err)
    }
    const maybeIt = (description, test) => migrations ? it(description, test) : it.skip(description, test)

    maybeIt('should be able to run a full migration', async () => {
        const USER_COLLECTION_OLD : CollectionDefinition = {
            version: new Date(2018, 7, 31),
            fields: {
                firstName: { type: 'string' },
                lastName: { type: 'string' },
            },
            indices: []
        }
        const USER_COLLECTION_NEW : CollectionDefinition = {
            version: new Date(2018, 8, 31),
            fields: {
                displayName: { type: 'string' },
            },
            indices: []
        }
        const USER_DATA_MIGRATIONS = {
            forward: [{type: 'writeField', collection: 'user', field: 'displayName', value: '`${object.firstName} ${object.lastName}`'}],
            backward: [
                { type: 'writeField', collection: 'user', field: 'firstName', value: {'object-property': [{split: ['$object.displayName', ' ']}, 0]} },
                { type: 'writeField', collection: 'user', field: 'lastName', value:  [{split: ['$object.displayName', ' ']}, 1]}
            ],
        }        

        const createStorageManager = async (includeNewUser : boolean, sequelize = null, initialize = true) => {
            const backend = new SequelizeStorageBackend({sequelizeConfig: 'sqlite://', sequelize})
            const storageManager = new StorageManager({ backend })
            storageManager.backend.use(new schemaEditor.SchemaEditorSequelizeBackendPlugin() as any)
            if (initialize) {
                storageManager.registry.registerCollections({
                    user: [
                        USER_COLLECTION_OLD,
                        ...(includeNewUser ? [USER_COLLECTION_NEW] : []),
                    ],
                })
                await storageManager.finishInitialization()
            }
            return storageManager
        }

        const firstStorageManager = await createStorageManager(false)
        await firstStorageManager.backend.migrate()
        const {object: user} = await firstStorageManager.collection('user').createObject({firstName: 'John', lastName: 'Doe'})
        const sequelize = (firstStorageManager.backend as SequelizeStorageBackend).sequelize
        const secondStorageManager = await createStorageManager(true, sequelize)
        const migrationSelection = { fromVersion: new Date(2018, 7, 31), toVersion: new Date(2018, 8, 31) }
        await migrations.executeMigration(
            secondStorageManager.registry,
            await createStorageManager(false, sequelize, false),
            migrationSelection,
            {
                dataOperations: USER_DATA_MIGRATIONS,
            },
            'all'
        )

        const newUserModel = sequelize['default'].define('newUser', {
            displayName: Sequelize.TEXT
        }, {tableName: 'users', timestamps: false})
        expect(await newUserModel.findAll({where: {id: user.id}})).toEqual([
            expect.objectContaining({dataValues: {id: 1, displayName: 'John Doe'}})
        ])
    })
})
