const logger = require('../utils/logger')
const ProxyHelper = require('../utils/proxyHelper')
const config = require('../../config/config')

class GlobalProxyConfigService {
  /**
   * 获取全局代理配置（从配置文件读取）
   */
  getConfig() {
    try {
      const globalProxy = config.proxy?.global || {}
      
      return {
        enabled: globalProxy.enabled === true,
        proxy: globalProxy.enabled && globalProxy.host && globalProxy.port
          ? {
              type: globalProxy.type || 'socks5',
              host: globalProxy.host,
              port: globalProxy.port,
              username: globalProxy.username || null,
              password: globalProxy.password || null
            }
          : null
      }
    } catch (error) {
      logger.error('❌ 获取全局代理配置失败:', error)
      return this.getDefaultConfig()
    }
  }

  /**
   * 获取默认配置
   */
  getDefaultConfig() {
    return {
      enabled: false,
      proxy: null
    }
  }

  /**
   * 检查全局代理是否启用
   */
  isEnabled() {
    try {
      const config = this.getConfig()
      return config.enabled === true
    } catch (error) {
      logger.error('❌ 检查全局代理状态失败:', error)
      return false
    }
  }

  /**
   * 获取有效的代理配置（如果启用则返回全局代理，否则返回 null）
   * 这个方法用于判断是否应该使用全局代理
   */
  getEffectiveProxyConfig() {
    try {
      const config = this.getConfig()
      if (config.enabled && config.proxy) {
        return config.proxy
      }
      return null
    } catch (error) {
      logger.error('❌ 获取有效代理配置失败:', error)
      return null
    }
  }
}

module.exports = new GlobalProxyConfigService()

