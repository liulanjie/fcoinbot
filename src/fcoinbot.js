const Fcoin = require('./fcoin');
const Log = require('./log');

const Zero = 0.000000000000000000;
const ExchangeUnit = 500.0;				// 初始交易单元(usdt)

const OrderState = {
    submitted: 'submitted',                 // 已提交
    partial_filled: 'partial_filled',       // 部分成交
    partial_canceled: 'partial_canceled',   // 部分成交已撤销
    filled: 'filled',                       // 完全成交
    canceled: 'canceled',                   // 已撤销
    pending_cancel: 'pending_cancel'        // 撤销已提交
};

const API = {
    key: 'xxx',
    secret: 'xxx'
};

const log = new Log();

class FCoinBot {
    constructor() {
        this.fcoin = new Fcoin(API);

        this.btc = {
            currency: 'btc',
            available: Zero,
            frozen: Zero,
            balance: Zero
        };

        this.usdt = {
            currency: 'usdt',
            available: Zero,
            frozen: Zero,
            balance: Zero
        };

        this.order = {
            buyId: '',
            sellId: ''
        };

        this.last20PriceGaps = [];
        this.lastPrice = 0;

        this.totalUSDTFees = 0;
        this.totalBTCFees = 0;

        this.lastTime = 0;
    }

    averageGap(currentGap) {
        this.last20PriceGaps.push(currentGap);
        if (this.last20PriceGaps.length > 20) {
            this.last20PriceGaps.splice(0, 1);
        }

        let total = this.last20PriceGaps.reduce((prev, curr) => {
            prev += Math.abs(curr);
            return prev;
        }, 0);

        return total / this.last20PriceGaps.length;
    }

    delay(ms) {
        return new Promise((resove, reject) => {
            setTimeout(() => {
                resove();
            }, ms);
        })
    }

    async startJob() {
        while (true) {
            await this.delay(10000);
            await this.buyAndSellBTC();
        }
    }

    async buyAndSellBTC() {
        try {
            // 获取余额
            await this._getBalance();

            // 先撤销上次未成交的交易，并计算交易费用
            await this._cancelOrders();

            // 进行交易
            await this._doExchange();

        } catch (exception) {
            console.warn(exception);
        }
    }

    async _doExchange() {
        let result = await this.fcoin.getTicker('btcusdt');
        if (result.status > 0) {
            throw result.msg;
        }

        let buy1Price = result.data.ticker[2];
        let buy1Amount = result.data.ticker[3];
        let sell1Price = result.data.ticker[4];
        let sell1Amount = result.data.ticker[5];

        let buyPrice = +(buy1Price + 0.01).toFixed(2);
        let sellPrice = +(sell1Price - 0.01).toFixed(2);
        if (sellPrice < buyPrice) {
            if (sell1Amount < buy1Amount) {
                sellPrice = buyPrice;
            } else {
                buyPrice = sellPrice;
            }
        } else {
            buyPrice = sellPrice = +((buyPrice + sellPrice) / 2).toFixed(2);
        }

        let average = 0;
        if (this.lastPrice > 0) {
            let priceGap = buyPrice - this.lastPrice;
            average = this.averageGap(priceGap);
            log.info(`LastPrice: ${this.lastPrice} CurrentPrice: ${buyPrice}, Price Gap: ${priceGap}, Average Gap: ${average}`);
        }
        this.lastPrice = buyPrice;

        // 价格平均变化指数过大时，停止交易
        if (average > 2) {
            return;
        }

        // 帐户BTC有余额，则先卖出
        if (this.btc.available > 0.001) {
            let sellUnit = +((this.btc.available - 0.0001).toFixed(4));
            this.fcoin.createOrder('btcusdt', 'sell', 'limit', sellPrice.toString(), sellUnit.toString()).then(result => {
                if (result.status > 0) {
                    log.warn(`创建sell订单(价格${sellPrice} 数量: ${sellUnit})失败，错误： ${result.msg}`);
                    this.order.sellId = '';
                } else {
                    this.order.sellId = result.data;
                    log.info(`创建sell订单(价格${sellPrice} 数量: ${sellUnit})成功，交易ID： ${this.order.sellId}`);
                }
            });

        }

        let middleBalance = Math.floor((this.usdt.available + this.btc.available * sellPrice) / 2);

        // 帐户usdt有余额，则进行购买
        if (this.usdt.available > 10) {
            let usdtUnit = Math.min(this.usdt.available, middleBalance, ExchangeUnit);
            let btcUnit = +((usdtUnit / buyPrice - 0.0001).toFixed(4));
            let result = await this.fcoin.createOrder('btcusdt', 'buy', 'limit', buyPrice.toString(), btcUnit.toString());
            if (result.status > 0) {
                log.warn(`创建buy订单(价格${buyPrice} 数量: ${btcUnit})失败，错误： ${result.msg}`);
                this.order.buyId = '';
            } else {
                this.order.buyId = result.data;
                log.info(`创建buy订单(价格${buyPrice} 数量: ${btcUnit})成功，交易ID： ${this.order.buyId}`);
            }
        }
    }

    async _cancelOrders() {

        if (this.usdt.frozen > 0 || this.btc.frozen > 0) {
            let result = await this.fcoin.getOrders('btcusdt', `${OrderState.submitted},${OrderState.partial_filled}`);
            console.log('order list: ', result);

            if (0 !== result.data.length) {
                result.data.forEach(async (order) => {
                    if (order.side === 'buy') {

                        let result = await this.fcoin.cancelOrder(order.id);
                        log.info(`撤销buy订单${order.id}, 返回`, result);
                    } else {

                        let result = await this.fcoin.cancelOrder(order.id);
                        log.info(`撤销sell订单${order.id}, 返回`, result);
                    }
                });
            }
        }
    }

    async _getBalance() {
        const data = await this.fcoin.getBalance();
        if (data.status > 0) {
            throw data.msg;
        }
        const balances = data.data;

        if (0 !== balances.length) {
            let btc = balances.find(item => item.currency === 'btc');
            if (btc) {
                this.btc.available = +btc.available;
                this.btc.frozen = +btc.frozen;
                this.btc.balance = +btc.balance;
            }

            let usdt = balances.find(item => item.currency === 'usdt');
            if (usdt) {
                this.usdt.available = +usdt.available;
                this.usdt.frozen = +usdt.frozen;
                this.usdt.balance = +usdt.balance;
            }

            log.info(`btc: 可用${this.btc.available}, 冻结${this.btc.frozen}, 总额${this.btc.balance}`);
            log.info(`usdt: 可用${this.usdt.available}, 冻结${this.usdt.frozen}, 总额${this.usdt.balance}`);
        }
    }

}

module.exports = FCoinBot;
