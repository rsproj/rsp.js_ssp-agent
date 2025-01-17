'use strict'

const debug = require('debug')('interactor:watchdog')
const child = require('child_process')
const path = require('path')
const RECONNECT_TENTATIVES_BEFORE_RESURRECT = 6

process.env.PM2_AGENT_ONLINE = true

module.exports = class WatchDog {
  static start (p) {
    this.ssp_binary_path = p.ssp_binary_path
    this.issp = p.conf.issp
    this.relaunching = false
    this.autoDumpTime = 5 * 60 * 1000

    /**
     * Handle PM2 connection state changes
     */
    this.issp.on('ready', _ => {
      debug('Connected to PM2')
      this.relaunching = false
      this.autoDump()
    })

    debug('Launching')

    this.reconnect_tentatives = 0

    this.issp.on('reconnecting', _ => {
      debug('PM2 is disconnected - Relaunching PM2')

      if (this.dump_interval) {
        clearInterval(this.dump_interval)
      }

      if (this.reconnect_tentatives++ >= RECONNECT_TENTATIVES_BEFORE_RESURRECT &&
          this.relaunching === false) {
        this.relaunching = true
        this.resurrect()
      }
    })
  }

  static stop() {
    clearInterval(this.dump_interval)
  }

  static resurrect () {
    debug(`Trying to launch PM2: ${path.resolve(__dirname, '../../../../bin/ssp')}`)
    child.exec(`node ${this.ssp_binary_path} resurrect`, (err, sto, ste) => {
      if (err) console.error(err)
      console.log(sto, ste)
      this.reconnect_tentatives = 0
      setTimeout(_ => {
        this.relaunching = false
      }, 10 * 1000)
    })
  }

  static autoDump () {
    this.dump_interval = setInterval(_ => {
      if (this.relaunching === true) return

      this.issp.sspInterface.dump(function (err) {
        return err ? debug('Error when dumping', err) : debug('PM2 process list dumped')
      })
    }, this.autoDumpTime)
  }
}
