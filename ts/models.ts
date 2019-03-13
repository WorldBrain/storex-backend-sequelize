import * as Sequelize from 'sequelize'
import { StorageRegistry } from '@worldbrain/storex'
import { CollectionDefinition, isChildOfRelationship, isConnectsRelationship, CollectionField } from '@worldbrain/storex/lib/types'

const FIELD_TYPE_MAP : {[name : string] : any} = {
    'auto-pk': {type: Sequelize.INTEGER, autoIncrement: true, primaryKey: true},
    'text': 'TEXT',
    'json': 'JSON',
    'datetime': 'DATE',
    'timestamp': 'FLOAT',
    'string': 'STRING',
    'boolean': 'BOOLEAN',
    'int': 'INTEGER',
    'float': 'FLOAT',
}

export function collectionToSequelizeModel({definition} : {definition : CollectionDefinition}) {
    const model = {}
    for (const [fieldName, fieldDefinition] of Object.entries(definition.fields)) {
        if (fieldDefinition.type == 'foreign-key') {
            continue
        }

        const modelFieldDef = fieldToSequelizeField(fieldDefinition, definition.name, fieldName)
        // modelFieldDef.field = fieldDefinition.fieldName

        if (definition.pkIndex === fieldName) {
            modelFieldDef.primaryKey = true
        }

        model[fieldName] = modelFieldDef
    }

    return model
}

export function fieldToSequelizeField(definition : CollectionField, collectionName : string, fieldName : string) {
    const primitiveType = definition.fieldObject ? definition.fieldObject.primitiveType : definition.type
    
    const fieldType = FIELD_TYPE_MAP[primitiveType]
    if (!fieldType) {
        throw new Error(`Unknown field type for field '${fieldName}' of collection '${collectionName}': '${primitiveType}'`)
    }

    const modelFieldDef = typeof fieldType === 'string'
        ? {type: Sequelize[fieldType]}
        : {...fieldType}
    modelFieldDef.allowNull = !!definition.optional

    return modelFieldDef
}

export function connectSequelizeModels({registry, models} : {registry : StorageRegistry, models : {[name : string] : any}}) {
    for (const [collectionName, collectionDefinition] of Object.entries(registry.collections)) {
        for (const relationship of collectionDefinition.relationships) {
            if (isChildOfRelationship(relationship)) {
                const targetModel = models[relationship.targetCollection]
                if (!targetModel) {
                    throw new Error(
                        `Collection ${collectionName} defines a (single)childOf relationship` +
                        `involving non-existing collection ${relationship.targetCollection}`
                    )
                }

                if (relationship.single) {
                    targetModel.hasOne(models[collectionName], {
                        foreignKey: relationship.fieldName
                    })
                } else {
                    targetModel.hasMany(models[collectionName], {
                        foreignKey: relationship.fieldName
                    })
                }
            } else if (isConnectsRelationship(relationship)) {
                const getModel = targetCollectionName => {
                    const model = models[targetCollectionName]
                    if (!model) {
                        throw new Error(
                            `Collection ${collectionName} defines a connects relationship` +
                            `involving non-existing collection ${targetCollectionName}`
                        )
                    }
                    return model
                }
                const leftModel = getModel(relationship.connects[0])
                const rightModel = getModel(relationship.connects[1])

                leftModel.belongsToMany(rightModel, {through: collectionName, foreignKey: relationship.fieldNames[0]})
                rightModel.belongsToMany(leftModel, {through: collectionName, foreignKey: relationship.fieldNames[1]})
            }
        }
    }
}
