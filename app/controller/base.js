'use strict';

const Controller = require('egg').Controller;

/**
 * controller基类：
 * - 提供默认的Service类名获取方法this.getServiceName，不允许被重写；
 * - 禁掉this.service访问，避免业务混乱;
 * - 提供统一的公共调用方法this.callService：校验参数和响应，传递参数;
 * - 提供this.success处理响应结果;
 */
class BaseController extends Controller {
  constructor(_ctx) {
    super(_ctx);
    // 禁掉this.service访问
    this.service = 'Overwrite service. Can\'t use service directly, please use callService!';
    this.errorCode = this.ctx.helper.errorCode;
    this.BizError = (error, code) => {
      if (process.env.NODE_ENV === 'development') {
        error = `${this.constructor.name} error:` + error;
      }
      throw new this.ctx.helper.BizError(error, code);
    };

    /**
     * 统一公共调用方法
     * @param {string} service_name 方法名称
     * @param {object} params 参数
     * @param {object} params_schema 参数校验Joi对象
     * @param {object} result_schema 结果校验Joi对象
     * @return {object} result 原始dao响应对象
     */
    this.callService = async (service_name, params, params_schema, result_schema) => {
      // controller 验证参数
      if (params_schema) {
        params_schema.validate(params, error => {
          if (!!error) {
            throw this.BizError('参数错误：' + error.message);
          }
        });
      }

      const result = await this.ctx.service[this.getServiceName()][service_name](params);
      // controller 验证响应结果
      if (result_schema) {
        result_schema.validate(result, error => {
          if (!!error) {
            throw this.BizError('结果错误：' + error.message);
          }
        });
      }
      return result;
    };
  }

  /**
   * get module name: dao class name default: [module name with first char uppercase]+Controller;
   * subclass can not overwrite 'getServiceName' for a different module name.
   * @abstract
   * @return {string} module name
  */
  getServiceName() {
    // convert first char to lower case
    const name = this.ctx.helper.lowerFirst(this.constructor.name);
    // substring length of 'controller'
    return name.substring(0, name.length - 10);
  }

  // 处理响应结果（正确响应报文）
  success(res) {
    return {
      code: 0,
      data: res,
    };
  }

}

module.exports = BaseController;
