const fs = require('fs');
const { Console } = require('console');
const util = require('util');

const options = {
    flags: 'a',
    encoding: 'utf8'
};

const output = fs.createWriteStream('./application.log', options);

const time = () => {
    const x = new Date(Date.now());
    const f = (t) => ('0' + t).slice(-2);
    return util.format('[%s-%s-%s %s:%s:%s]',
        x.getFullYear().toString(),
        f(x.getMonth()),
        f(x.getDate()),
        f(x.getHours()),
        f(x.getMinutes()),
        f(x.getSeconds())
    );
};

class Log {
    constructor() {
        this.console = new Console({ stdout: output, stderr: output });
    }
    error(...args) {
        this.console.error(time(), '[ERROR]', ...args);
    }
    info(...args) {
        this.console.error(time(), '[INFO]', ...args);
    }
    warn(...args) {
        this.console.warn(time(), '[WARN]', ...args);
    }
    debug(...args) {
        this.console.log(time(), '[DEBUG]', ...args);
    }
}

module.exports = Log;