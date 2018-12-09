import * as Sequelize from 'sequelize'
import { StorageRegistry } from 'storex'
import { CollectionDefinition, isChildOfRelationship, isConnectsRelationship } from 'storex/lib/types'

const FIELD_TYPE_MAP : {[name : string] : any} = {
    'auto-pk': {type: Sequelize.INTEGER, autoIncrement: true, primaryKey: true},
    'text': 'TEXT',
    'json': 'JSON',
    'datetime': 'DATE',
    'string': 'STRING',
    'boolean': 'BOOLEAN',
}

export function collectionToSequelizeModel({definition, registry} : {definition : CollectionDefinition, registry : StorageRegistry}) {
    const model = {}
    for (const [fieldName, fieldDefinition] of Object.entries(definition.fields)) {
        if (fieldDefinition.type == 'foreign-key') {
            continue
        }

        const primitiveType = fieldDefinition.fieldObject ? fieldDefinition.fieldObject.primitiveType : fieldDefinition.type
        const modelFieldDef = typeof FIELD_TYPE_MAP[primitiveType] === 'string'
            ? {type: Sequelize[FIELD_TYPE_MAP[primitiveType]]}
            : {...FIELD_TYPE_MAP[primitiveType]}

        if (definition.pkIndex === fieldName) {
            modelFieldDef.primaryKey = true
        }
        // modelFieldDef.field = fieldDefinition.fieldName

        model[fieldName] = modelFieldDef
    }

    return model
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
