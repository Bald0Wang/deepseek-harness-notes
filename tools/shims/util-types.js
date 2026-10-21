// node:util/types 的浏览器 shim。

function typeofCheck(type) {
  return (value) => typeof value === type
}

export const isPromise = (value) => value instanceof Promise
export const isNativeError = (value) => value instanceof Error
export const isDate = (value) => value instanceof Date
export const isRegExp = (value) => value instanceof RegExp
export const isArray = Array.isArray
export const isFunction = typeofCheck('function')
export const isObject = (value) => value !== null && typeof value === 'object'
export const isString = typeofCheck('string')
export const isNumber = typeofCheck('number')
export const isBoolean = typeofCheck('boolean')
export const isUndefined = (value) => value === undefined
export const isNull = (value) => value === null

export default { isPromise, isNativeError, isDate, isRegExp, isArray, isFunction, isObject, isString, isNumber, isBoolean, isUndefined, isNull }
