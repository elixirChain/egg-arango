'use strict';

const { aql } = require('arangojs');
// const { Database, aql } = require('arangojs');
// const ARANGO = Symbol.for('Application#arango');

module.exports = {
  // get arango() {
  //   const { arango } = this.config;
  //   if (!this[ARANGO]) {
  //     this[ARANGO] = new Database({ url: arango.url }).useBasicAuth(arango.username, arango.password);
  //     console.log('------ connecting database ------');
  //   }
  //   return this[ARANGO];
  // },

  get aql() {
    return aql;
  },
};
