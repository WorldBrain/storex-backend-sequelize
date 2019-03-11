const fromPairs = require('lodash/fp/fromPairs')
const mapValues = require('lodash/fp/mapValues')
import * as Sequelize from 'sequelize'
import { StorageRegistry, CollectionDefinition } from '@worldbrain/storex'
import { dissectCreateObjectOperation, convertCreateObjectDissectionToBatch, CreateObjectDissection, setIn } from '@worldbrain/storex/lib/utils'
// import { CollectionDefinition } from '../../manager/types'
import * as backend from '@worldbrain/storex/lib/types/backend'
import { StorageBackendFeatureSupport } from '@worldbrain/storex/lib/types/backend-features';
import { DeletionTooBroadError } from '@worldbrain/storex/lib/types/errors'
import { augmentCreateObject } from '@worldbrain/storex/lib/backend/utils'
import { collectionToSequelizeModel, connectSequelizeModels } from './models'
import { operatorsAliases } from './operators'
import { cleanRelationshipFieldsForWrite, cleanRelationshipFieldsForRead, cleanOptionalFieldsForRead, cleanRelationshipFieldsAfterCreate } from './utils';
import { createPostgresDatabaseIfNecessary } from './create-database';

export interface InternalOptions {
    _transaction? : any
}

export type SequelizeMap = {[database : string]: Sequelize.Sequelize}
export class SequelizeStorageBackend extends backend.StorageBackend {
    readonly type = 'sequelize'
    private sequelizeConfig : Sequelize.Options | string
    public sequelize : SequelizeMap
    public sequelizeModels : {[database : string]: {[name : string]: any}} = {}
    readonly defaultDatabase : string
    readonly databases : string[]
    features : StorageBackendFeatureSupport = {
        transaction: true,
        singleFieldSorting: true,
        resultLimiting: true,
        executeBatch: true,
    }

    constructor(
        {sequelizeConfig, sequelize, defaultDatabase, databases, logging = false} :
        {sequelizeConfig : any, sequelize? : SequelizeMap, defaultDatabase? : string, databases? : string[], logging? : boolean}
    ) {
        super()
        
        this.sequelizeConfig = sequelizeConfig
        this.defaultDatabase = defaultDatabase || sequelizeConfig.database || 'default'
        this.databases = databases || ['default']
        this.sequelize = sequelize || this._createSequelize(logging)
    }

    configure({registry} : {registry : StorageRegistry}) {
        super.configure({registry})
        registry.once('initialized', this._createModels)

        // const origCreateObject = this.createObject.bind(this)
        // this.createObject = async (collection, object, options = {}, internal = {}) => {
        //     const createObject = transactionOperation =>
        //         transactionOperation
        //         ? (...args) => transactionOperation(origCreateObject, ...args)
        //         : origCreateObject
        //     const execute = async (transactionOperation) => {
        //         const augmentedCreateObject = augmentCreateObject(createObject(transactionOperation), { registry })
        //         return await augmentedCreateObject(collection, object, options)
        //     }

        //     if (!options._transaction && !internal._transaction) {
        //         return await this.operation('transaction', {}, async ({transactionOperation}) => {
        //             return await execute(transactionOperation)
        //         })
        //     } else {
        //         return await execute(null)
        //     }
        // }
    }

    _createSequelize(logging : boolean) {
        const defaultOptions = {
            logging,
            operatorsAliases
        }
        if (typeof this.sequelizeConfig === 'string') {
            return fromPairs(this.databases.map(database => [database, new Sequelize(<string>this.sequelizeConfig, defaultOptions)]))
        } else {
            return fromPairs(this.databases.map(database => [database, new Sequelize({
                ...defaultOptions,
                ...<Sequelize.Options>this.sequelizeConfig,
                database,
            })]))
        }
    }

    _createModels = () => {
        for (const database of this.databases) {
            this.sequelizeModels[database] = {}

            for (const [name, definition] of Object.entries(this.registry.collections)){
                this.sequelizeModels[database][name] = this.sequelize[database].define(
                    name, collectionToSequelizeModel({definition}),
                    {timestamps: false},
                )
            }
        }
        for (const database of this.databases) {
            connectSequelizeModels({registry: this.registry, models: this.sequelizeModels[database]})
        }
    }

    async migrate({database} : {database? : string} = {}) {
        database = database || this.defaultDatabase

        if (typeof this.sequelizeConfig !== 'string' && this.sequelizeConfig['dialect'] === 'postgres') {
            const { host, port, username, password } = this.sequelizeConfig
            await createPostgresDatabaseIfNecessary({ host, port, username, password, database })
        }
        await this.sequelize[database].sync()
    }

    async cleanup() : Promise<any> {

    }

    async createObject(collection : string, object, options : backend.CreateSingleOptions & InternalOptions = {}, internal : InternalOptions = {}) : Promise<backend.CreateSingleResult> {
        return this._complexCreateObject(collection, object, {...options, needsRawCreates: false, _transaction: null})
    }

    async _complexCreateObject(collection: string, object, options: backend.CreateSingleOptions & {needsRawCreates : boolean, _transaction : any}) {
        const dissection = dissectCreateObjectOperation({operation: 'createObject', collection, args: object}, this.registry)
        const batchToExecute = convertCreateObjectDissectionToBatch(dissection)
        const batchResult = await this._rawExecuteBatch(batchToExecute, {needsRawCreates: options.needsRawCreates, _transaction: options._transaction})
        this._reconstructCreatedObject(object, collection, dissection, batchResult.info)

        return { object }
    }

    async _reconstructCreatedObject(object, collection : string, operationDissection : CreateObjectDissection, batchResultInfo) {
        for (const step of operationDissection.objects) {
            const collectionDefiniton = this.registry.collections[collection]
            const pkIndex = collectionDefiniton.pkIndex
            setIn(object, [...step.path, pkIndex], batchResultInfo[step.placeholder].object[pkIndex as string])
        }
    }

    async _rawCreateObject(collection: string, object, options : backend.CreateSingleOptions & InternalOptions = {}, internal : InternalOptions = {}) {
        const collectionDefinition = this.registry.collections[collection]
        const model = this._getModel(collection, options)
        const cleanedObject = cleanRelationshipFieldsForWrite(object, this.registry.collections[collection])
        await Promise.all(collectionDefinition.fieldsWithCustomType.map(
            async fieldName => {
                const fieldDef = collectionDefinition.fields[fieldName]
                cleanedObject[fieldName] = await fieldDef.fieldObject.prepareForStorage(cleanedObject[fieldName])
            }
        ))

        const transaction = options._transaction && internal._transaction
        const instance = await model.create(cleanedObject, {transaction})
        // console.log('created object in collection', collection)
        return {object: cleanRelationshipFieldsAfterCreate(instance.dataValues, collectionDefinition)}
    }
    
    async findObjects<T>(collection : string, query, options : backend.FindManyOptions = {}) : Promise<Array<T>> {
        // console.log('finding object in collection', collection)
        const {collectionDefinition, model, where} = this._prepareQuery(collection, query, options)
        const order = options.order && options.order.map(pair => [pair[0], pair[1].toUpperCase()])

        const instances = await model.findAll({where, order, limit: options.limit})
        // console.log('done finding object in collection', collection)
        let objects = instances.map(instance => cleanRelationshipFieldsForRead(
            instance.dataValues,
            collectionDefinition
        ))

        return objects.map(object => cleanOptionalFieldsForRead(object, collectionDefinition))
    }
    
    async updateObjects(collection : string, query, updates, options : backend.UpdateManyOptions & InternalOptions = {}, internal : InternalOptions = {}) : Promise<backend.UpdateManyResult> {
        const {collectionDefinition, model, where} = this._prepareQuery(collection, query, options)
        
        const cleanedUpdates = cleanRelationshipFieldsForWrite(updates, collectionDefinition)
        const transaction = options._transaction && internal._transaction
        await model.update(cleanedUpdates, {where, transaction})
    }
    
    async deleteObjects(collection : string, query, options : backend.DeleteManyOptions & InternalOptions = {}, internal : InternalOptions = {}) : Promise<backend.DeleteManyResult> {
        const {model, where} = this._prepareQuery(collection, query, options)
        
        if (options.limit) {
            const count = await model.count({ where })
            if (count > options.limit) {
                throw new DeletionTooBroadError(collection, query, options.limit, count)
            }
        }

        const transaction = options._transaction && internal._transaction
        await model.destroy({where, transaction})
    }

    async executeBatch(batch : backend.OperationBatch) {
        return this.sequelize[this.defaultDatabase].transaction(async transaction => {
            return this._rawExecuteBatch(batch, {needsRawCreates: false, _transaction: transaction})
        })
    }

    async _rawExecuteBatch(
        batch : backend.OperationBatch,
        options : {needsRawCreates : boolean, _transaction : any}
    ) {
        const info = {}
        const placeholders = {}
        for (const operation of batch) {
            if (operation.operation === 'createObject') {
                for (const {path, placeholder} of operation.replace || []) {
                    operation.args[path as string] = placeholders[placeholder].id
                }

                const { object } = options.needsRawCreates
                    ? await this._rawCreateObject(operation.collection, operation.args)
                    : await this._complexCreateObject(operation.collection, operation.args, {needsRawCreates: true, _transaction: options._transaction})
                info[operation.placeholder] = {object}
                placeholders[operation.placeholder] = object
            } else if (operation.operation === 'updateObjects') {
                await this.updateObjects(operation.collection, operation.where, operation.updates)
            }
        }
        return { info }
    }

    async transaction(options, runner) {
        return this.sequelize[this.defaultDatabase].transaction(async transaction => {
            const transactionOperation = async (operation, ...args) => {
                if (typeof operation === 'string') {
                    return await this.operation(operation, ...args, {_transaction: transaction})
                } else {
                    return await operation(...args, {_transaction: transaction})
                }
            }
            return await runner({transactionOperation})
        })
    }

    _getModel(collection : string, options : {database? : string} = {}) : Sequelize.Model {
        return this.sequelizeModels[options.database || this.defaultDatabase][collection]
    }

    _prepareQuery(collection : string, query, options : {database? : string}) : {collectionDefinition : CollectionDefinition, model : Sequelize.Model, where : any} {
        const collectionDefinition = this.registry.collections[collection]
        const model = this._getModel(collection, options)
        const where = cleanRelationshipFieldsForWrite(query, collectionDefinition)
        return {collectionDefinition, model, where}
    }
}
