'use strict';

const Service = require('egg').Service;

/**
 * Service基类：
 * - 提供默认的Dao类名获取方法this.getDaoName，允许被重写指定Dao服务；
 * - 提供通用的基本业务处理方法
 *  - Document API
 *  - Edge API
 *  - Graph API
 */
class BaseService extends Service {
  constructor(_ctx) {
    super(_ctx);
    this.dao = this.ctx.dao;
    this.BizError = (error, code) => {
      if (process.env.NODE_ENV === 'development') {
        error = `${this.constructor.name} error:` + error;
      }
      throw new this.ctx.helper.BizError(error, code);
    };
  }

  /**
   * get Dao name:
   *   1.service class name default: [dao name with first char uppercase]+Service;
   *   2.subclass can overwrite 'getDaoName' for a different dao name.
   * @abstract
   * @return {string} module name
   */
  getDaoName() {
    // convert first char to lower case
    const name = this.ctx.helper.lowerFirst(this.constructor.name);
    // substring length of 'service'
    return name.substring(0, name.length - 7);
  }

  /**
   * Document API
   * All params comment refer to BaseDao.
   */

  async get(_id, options) {
    return this.dao[this.getDaoName()].get(_id, options);
  }

  async getByFilter(filter, options) {
    return this.dao[this.getDaoName()].getByFilter(filter, options);
  }

  async gets(_params) {
    return this.dao[this.getDaoName()].gets(_params);
  }

  async getsByFilter(_params) {
    return this.dao[this.getDaoName()].getsByFilter(_params);
  }

  async getPage(_params) {
    return this.dao[this.getDaoName()].getPage(_params);
  }

  async save(doc) {
    return this.dao[this.getDaoName()].save(doc);
  }

  async saves(docs) {
    return this.dao[this.getDaoName()].saves(docs);
  }

  async update(_params) {
    return this.dao[this.getDaoName()].update(_params);
  }

  async updates(_params) {
    return this.dao[this.getDaoName()].updates(_params);
  }

  async updatesEach(_params) {
    return this.dao[this.getDaoName()].updates(_params);
  }

  async delete(_id) {
    return this.dao[this.getDaoName()].delete(_id);
  }

  async physicalDelete(_id) {
    return this.dao[this.getDaoName()].physicalDelete(_id);
  }

  async deletes(_ids) {
    return this.dao[this.getDaoName()].deletes(_ids);
  }

  /**
   * Edge Document API
   * All params comment refer to BaseDao.
   */

  async getEdge(_id) {
    return this.dao[this.getDaoName()].getEdge(_id);
  }

  async getEdges(_ids) {
    return this.dao[this.getDaoName()].getEdges(_ids);
  }

  async deleteEdge(_id) {
    return this.dao[this.getDaoName()].deleteEdge(_id);
  }

  async deleteEdges(_ids) {
    return this.dao[this.getDaoName()].deleteEdges(_ids);
  }

  async deleteEdgesByVertex(_params) {
    return this.dao[this.getDaoName()].deleteEdgesByVertex(_params);
  }

  async saveEdge(_params) {
    return this.dao[this.getDaoName()].saveEdge(_params);
  }

  async saveEdges(_params) {
    return this.dao[this.getDaoName()].saveEdges(_params);
  }

  async updateEdge(_params) {
    return this.dao[this.getDaoName()].updateEdge(_params);
  }

  async updateEdges(_params) {
    return this.dao[this.getDaoName()].updateEdges(_params);
  }

  async updateEdgesEach(_params) {
    return this.dao[this.getDaoName()].updateEdges(_params);
  }

  async outVertices(_params) {
    return this.dao[this.getDaoName()].outVertices(_params);
  }

  async inVertices(_params) {
    return this.dao[this.getDaoName()].inVertices(_params);
  }

  async outVerticesPage(_params) {
    return this.dao[this.getDaoName()].outVerticesPage(_params);
  }

  async inVerticesPage(_params) {
    return this.dao[this.getDaoName()].inVerticesPage(_params);
  }

  /**
   * Graph Document API
   * All params comment refer to BaseDao.
   */

  async outGraphVertices(_params) {
    return this.dao[this.getDaoName()].outGraphVertices(_params);
  }

  async inGraphVertices(_params) {
    return this.dao[this.getDaoName()].inGraphVertices(_params);
  }

}

module.exports = BaseService;
