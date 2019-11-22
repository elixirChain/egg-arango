'use strict';

const SYMBOL_DAO = Symbol('dao');

module.exports = {

  /**
   * dao instance
   * @member Context#dao
   */

  get dao() {
    /* istanbul ignore else */
    if (!this[SYMBOL_DAO]) {
      const dao = {};
      for (const [ type, Class ] of this.app.daoClass) {
        dao[type] = new Class(this);
      }
      this[SYMBOL_DAO] = dao;
    }
    return this[SYMBOL_DAO];
  },
};
