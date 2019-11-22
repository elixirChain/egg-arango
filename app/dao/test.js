'use strict';

const BaseDao = require('./base.js');

class TestDao extends BaseDao {
  /**
   * 数据访问处理，基本文档查询参考 'BaseDao.md'。
   *  - （默认不需要）可以通过重写getCollectionName可以指定collection；
   *  - 和数据库collection一一对应；
   *  - 只包含collection的数据操作，不能含有业务逻辑；
   *  - 特殊情况再考虑使用自定义AQL调用this.query实现数据操作；
  */

  /**
   * test
   * @test
   * @return {string} - dear enjoy yourself.
   */
  async test() {
    const query = this.aql`return "dear enjoy yourself."`;
    this.logger.debug('---Dao debug---');
    this.logger.info('---Dao Info---');
    this.logger.warn('---Dao Warn---');
    this.logger.error('---Dao Error---');
    try {
      return await this.query(query);
    } catch (error) {
      throw this.BizError(error.message);
    }
  }
}

module.exports = TestDao;
