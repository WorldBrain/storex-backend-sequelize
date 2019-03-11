import { CollectionDefinition, isChildOfRelationship, isConnectsRelationship } from '@worldbrain/storex/lib/types'

export function cleanRelationshipFieldsAfterCreate(object, collectionDefinition : CollectionDefinition) {
    for (const relationship of collectionDefinition.relationships) {
        if (isChildOfRelationship(relationship)) {
            delete object[relationship.fieldName]
        }
    }
    return object
}

export function cleanOptionalFieldsForRead(object, collectionDefinition : CollectionDefinition) {
    for (const [fieldName, fieldDefinition] of Object.entries(collectionDefinition.fields)) {
        if (fieldDefinition.optional) {
            delete object[fieldName]
        }
    }
    return object
}

export function cleanRelationshipFieldsForWrite(object, collectionDefinition : CollectionDefinition) {
    return _cleanRelationshipFields(object, collectionDefinition, (alias : string, fieldName : string) => {
        if (!object[alias]) {
            return
        }

        object[fieldName] = object[alias]
        delete object[alias]
    })
}

export function cleanRelationshipFieldsForRead(object, collectionDefinition : CollectionDefinition) {
    return _cleanRelationshipFields(object, collectionDefinition, (alias : string, fieldName : string) => {
        object[alias] = object[fieldName]
        delete object[fieldName]
    })
}

export function _cleanRelationshipFields(
    object, collectionDefinition : CollectionDefinition, cleaner : (alias : string, fieldName : string) => void
) {
    for (const relationship of collectionDefinition.relationships || []) {
        if (isChildOfRelationship(relationship)) {
            cleaner(relationship.alias, relationship.fieldName)
        } else if (isConnectsRelationship(relationship)) {
            cleaner(relationship.aliases[0], relationship.fieldNames[0])
            cleaner(relationship.aliases[1], relationship.fieldNames[1])
        }
    }

    return object
}