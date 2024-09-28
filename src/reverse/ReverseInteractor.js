
'use strict'

const debug = require('debug')('interactor:reverse')

/**
 * ReverseInteractor is the class that handle receiving event from KM
 * @param {Object} opts interactor options
 * @param {PM2} ssp ssp api
 * @param {WebsocketTransport} transport websocket transport used to receive data to KM
 */
module.exports = class ReverseInteractor {
  constructor (opts, issp, transport) {
    this.issp = issp
    this.transport = transport
    this.opts = opts
    this.remoteMethodAlloweds = this.opts.PM2_REMOTE_METHOD_ALLOWED
  }

  start () {
    debug('Reverse interactor is listening')
    // action that trigger custom actions inside the code
    this.transport.on('trigger:action', this._onCustomAction.bind(this))
    this.transport.on('trigger:scoped_action', this._onCustomAction.bind(this))
    // action that call ssp api
    this.transport.on('trigger:ssp:action', this._onPM2Action.bind(this))
  }

  stop () {
    debug('Reverse interactor is no longer listening')
    this.transport.removeAllListeners('trigger:action')
    this.transport.removeAllListeners('trigger:scoped_action')
    this.transport.removeAllListeners('trigger:ssp:action')
  }

  /**
   * Listener for custom actions that can be triggered by KM, either scoped or normal
   * @param {Object} data
   * @param {Object} data.action_name name of the action triggered
   * @param {Object} [data.app_name] name of the process where the action need to be run
   * @param {Object} [data.process_id] id of the process where the action need to be run
   * @param {Object} [data.opts] parameters used to call the method
   * @param {Object} [data.uuid] uuid used to recognized the scoped action (scoped action only)
   */
  _onCustomAction (data) {
    const type = data.uuid ? 'SCOPED' : 'REMOTE'

    data.process_id = data.process_id !== undefined ? data.process_id : data.process.pm_id
    debug('New %s action %s triggered for process %s', type, data.action_name, data.process_id)
    // send the request to pmx via IPC
    this.issp.msgProcess({
      name: data.app_name,
      id: data.process_id,
      msg: data.action_name,
      opts: data.opts || data.options || null,
      action_name: data.action_name,
      uuid: data.uuid
    }, (err, res) => {
      if (err) {
        return this.transport.send('trigger:action:failure', {
          success: false,
          err: err.message || err,
          id: data.process_id,
          action_name: data.action_name
        })
      }
      debug('Message received from AXM for proc_id : %s and action name %s', data.process_id, data.action_name)
      return this.transport.send('trigger:action:success', {
        success: true,
        id: data.process_id,
        action_name: data.action_name
      })
    })
  }

  /**
   * Handle when KM call a ssp action
   * @param {Object} data
   * @param {Object} data.method_name the name of the ssp method
   * @param {Object} data.parameters optional parameters used to call the method
   */
  _onPM2Action (data) {
    // callback when the action has been executed
    let callback = (err, res) => {
      debug('PM2 action ended : ssp %s (%s)', data.method_name, !err ? 'no error' : (err.message || err))
      this.transport.send('trigger:ssp:result', {
        ret: { err: err, data: res },
        meta: {
          method_name: data.method_name,
          app_name: data.parameters.name,
          machine_name: this.opts.MACHINE_NAME,
          public_key: this.opts.PUBLIC_KEY
        }
      })
    }
    if (typeof data.method_name !== 'string') {
      return debug('New PM2 action triggered with invalid method name: ', data.method_name)
    }
    if (this.remoteMethodAlloweds.indexOf(data.method_name) === -1) {
      return callback(new Error('Method not allowed'))
    }

    debug('New PM2 action triggered : ssp %s %j', data.method_name, data.parameters)

    const method = data.method_name
    let parameters = data.parameters
    try {
      parameters = JSON.parse(JSON.stringify(data.parameters))
    } catch (err) {
      console.error(err)
    }

    if (method === 'startLogging') {
      global._logs = true
      // Stop streaming logs automatically after timeout
      clearTimeout(this._loggingTimeoutId)
      this._loggingTimeoutId = setTimeout(function () {
        global._logs = false
      }, process.env.NODE_ENV === 'test' ? 10 : 120000)
      return callback(null, 'Log streaming enabled')
    } else if (method === 'stopLogging') {
      global._logs = false
      return callback(null, 'Log streaming disabled')
    }

    return this.issp.remote(method, parameters, callback)
  }
}
