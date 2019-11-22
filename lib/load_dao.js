'use strict';

const fs = require('fs');
const path = require('path');

const SYMBOL_DAO_CLASS = Symbol('Application#daoClass');

module.exports = app => {
  const basePath = path.join(app.baseDir, 'app/dao');
  const types = walk(basePath);

  Object.defineProperty(app, 'daoClass', {
    get() {
      if (!this[SYMBOL_DAO_CLASS]) {
        const classes = new Map();

        types.forEach(type => {
          const Dao = require(type);
          const daoName = path.basename(type);
          classes.set(daoName.substring(0, daoName.lastIndexOf('.')), Dao);
        });
        this[SYMBOL_DAO_CLASS] = classes;
      }
      return this[SYMBOL_DAO_CLASS];
    },
  });
};

function walk(dir) {
  let results = [];
  const list = fs.readdirSync(dir);
  list.forEach(function(file) {
    file = dir + '/' + file;
    const stat = fs.statSync(file);
    if (stat && stat.isDirectory()) results = results.concat(walk(file));
    else results.push(file);
  });
  return results;
}
