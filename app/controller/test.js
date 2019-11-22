'use strict';

const BaseController = require('./base.js');
const Joi = require('@hapi/joi');

class TestController extends BaseController {
  /**
   * controller开发规范：参数校验，访问转发。
   *  - 不允许重写getServiceName；
   *  - 只能使用callService调用同名service的服务;
   *  - （默认使用）使用this.success处理响应结果;
   */

  // 测试服务是否正常
  async test() {
    const { ctx, callService } = this;
    // 测试logger
    this.logger.debug('---Controller debug---');
    this.logger.info('---Controller Info---');
    this.logger.warn('---Controller Warn---');
    this.logger.error('---Controller Error---');

    // 调用service服务
    const params = {};
    const result = await callService('test', params, null, null);
    ctx.body = this.success(result);
  }

  // 示例 callback接口
  async callBack() {
    const { ctx } = this;
    this.logger.debug('ctx.request.ip: ', ctx.request.ip);
    this.logger.debug('ctx.request.path: ', ctx.request.path);
    this.logger.debug('ctx.header: ', ctx.header);
    this.logger.debug('ctx.query: ', ctx.query);
    this.logger.debug('ctx.request.body: ', ctx.request.body);
    this.ctx.body = 'callback';
  }

  /**
   * 示例基本接口代码，包含：新增/查询/按分页查询/修改/删除
   * 根据需要参考使用，原则上只能通过callService调用本模块的service层服务
   */

  // 新增
  async save() {
    const { ctx, callService } = this;
    const result = await callService(
      // 'saves',
      // [ ctx.request.body, ctx.request.body ]
      'save',
      ctx.request.body,
      Joi.object({
        name: Joi.string().required(),
      })
    );
    ctx.body = this.success(result);
  }

  // 查询
  async get() {
    const { ctx, callService } = this;
    const result = await callService(
      // 'getByFilter',
      // ctx.request.body
      'get',
      ctx.request.body._id,
      Joi.string().required()
    );
    ctx.body = this.success(result);
  }

  // 按分页查询
  async getPage() {
    const { ctx, callService } = this;
    const result = await callService(
      'getsByFilter',
      {
        filter: { name: [ 'string' ] },
        // filter: { name: 'string' },
        // sorts: [
        //   {
        //     field: 'name',
        //     direction: 'desc',
        //   },
        // ],
      }
      // 'gets',
      // [ 'client/36651229', 'client/36651345' ]
      // 'getPage',
      // ctx.request.body,
      // {
      //   page_num: 0,
      //   page_size: 2,
      //   sorts: [
      //     {
      //       field: 'name',
      //       // direction: undefined,
      //     },
      //   ],
      // filter: {
      //   name: 'string',
      // },
      // like: {
      //   or: [{
      //     field: 'name',
      //     search: 'string',
      //   },
      //   {
      //     field: 'name',
      //     search: 'string2',
      //   }],
      // },
      // },
    );
    ctx.body = this.success(result);
  }

  // 修改
  async update() {
    const { ctx, callService } = this;
    const result = await callService(
      'updates',
      [
        {
          _id: 'user/36875120',
          newObj: {
            name: 'mod string',
          },
        },
      ]
      // 'update',
      // ctx.request.body,
      // Joi.object({
      //   _id: Joi.string().required(),
      //   newObj: Joi.object({
      //     name: Joi.string().required(),
      //   }).required(),
      // })
    );
    ctx.body = this.success(result);
  }

  // 删除
  async delete() {
    const { ctx, callService } = this;
    const result = await callService(
      // 'deletes',
      // [ ctx.request.body._id ]
      'delete',
      ctx.request.body._id
      // Joi.string().required(),
    );
    ctx.body = this.success(result);
  }

  // 新增 边表数据
  async saveEdge() {
    const { ctx, callService } = this;
    const result = await callService(
      'saveEdge',
      // 'saveEdges',
      ctx.request.body
    );
    ctx.body = this.success(result);
  }

  // 查询 边表数据
  async getVertices() {
    const { ctx, callService } = this;
    const result = await callService(
      // 'outVertices',
      'outVerticesPage',
      // 'inVertices',
      // 'inVerticesPage',
      // 'outGraphVertices',
      // 'inGraphVertices',
      ctx.request.body
    );
    ctx.body = this.success(result);
  }

}

module.exports = TestController;
