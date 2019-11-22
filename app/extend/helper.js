'use strict';

const { BizError, SysError } = require('./lib/error');
const { underlineCase, lowerFirst, upperFirst, lowerCamelize, upperCamelize } = require('./lib/string');
const { batch, modifyValues } = require('./lib/object');

module.exports = {
  BizError,
  SysError,
  underlineCase, lowerFirst, upperFirst,
  lowerCamelize, upperCamelize,
  batch,
  modifyValues,
};
