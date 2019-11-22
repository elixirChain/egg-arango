'use strict';

const BaseService = require('./base.js');

class TestService extends BaseService {
  /**
   * service开发规范：具体业务逻辑，处理异常。
   *  - （默认不需要）可以通过重写getDaoName可以指定dao层服务；
   *  - 使用base方法，调用Dao层服务；
   *   - 或重写base方法，实现新业务逻辑（注意：不能通过this.func调用同名方法）；
   *   - 或调用多个dao组合复杂业务；
   *   - 或者调用第三方接口；
   */

  async test() {
    /** 日志打印*/
    this.logger.debug('---Service debug---');
    this.logger.info('---Service Info---');
    this.logger.warn('---Service Warn---');
    this.logger.error('---Service Error---');

    try {
      return await this.dao.test.test();
    } catch (error) {
      // 这里抛出业务错误，直接统一响应，不需要在controller处理！
      throw this.BizError(error.message);
    }
  }

  async get(_id) {
    const options = { keepAttrs: 'name,_id,_key' };
    return await this.dao.user.get(_id, options);
  }

  // 调用其他模块dao
  async saveEdge(params) {
    return await this.dao.userToRole.saveEdge(params);
  }
  async saveEdges(params) {
    return await this.dao.userToRole.saveEdges(params);
  }
  async outVertices(params) {
    return await this.dao.userToRole.outVertices(params);
  }
  async outVerticesPage(params) {
    params = {
      _id: 'user/1',
      page_num: 0,
      page_size: 10,
      v_filter: { name: 'user11' },
      options: { keepAttrs: '_id,name,type,_key' },
    };
    return await this.dao.userToRole.outVerticesPage(params);
  }
  async inVertices(params) {
    return await this.dao.userToRole.inVertices(params);
  }
  async inVerticesPage(params) {
    params = {
      _id: 'role/1',
      page_num: 0,
      page_size: 10,
      v_filter: {},
      options: { keepAttrs: '_id,name,type,_key' },
    };
    return await this.dao.userToRole.inVerticesPage(params);
  }
  async outGraphVertices(params) {
    return await this.dao.organizationGraph.outGraphVertices(params);
  }
  async inGraphVertices(params) {
    return await this.dao.organizationGraph.inGraphVertices(params);
  }

}

module.exports = TestService;
