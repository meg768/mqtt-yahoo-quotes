#!/usr/bin/env node

var yahoo = require('yahoo-finance');
var Timer = require('yow/timer');
var MQTT = require('mqtt');


require('dotenv').config();
require('yow/prefixConsole')();

class App {

	constructor() {
		let yargs = require('yargs');

		let config  = require('yow/config')();

		yargs.usage('Usage: $0 [options]')

		yargs.option('help',     {alias:'h', describe:'Displays this information'});
		yargs.option('host',     {describe:'Specifies MQTT host', default:config.host});
		yargs.option('password', {describe:'Password for MQTT broker', default:config.password});
		yargs.option('username', {describe:'User name for MQTT broker', default:config.username});
		yargs.option('port',     {describe:'Port for MQTT', type:'number', default:parseInt(config.port) || 1883});
		yargs.option('interval', {describe:'Poll interval in minutes', type:'number', default:parseInt(config.interval) || 15});
		yargs.option('topic',    {describe:'MQTT root topic', default:config.topic || 'Yahoo Quotes'});
		yargs.option('debug',    {describe:'Debug mode', type:'boolean', default:config.debug || false});

		yargs.help();
		yargs.wrap(null);

		yargs.check(function(argv) {
			return true;
		});

		this.argv     = yargs.argv;
		this.log      = console.log;
		this.config   = config;
		this.equities = config.equities;
		this.debug    = this.argv.debug ? this.log : () => {};
		this.timer    = new Timer();
		this.cache    = {};

	}


	async fetchQuotes(symbols) {

		var params = {};

		if (symbols.length == 0)
			return {};

		params.symbols = symbols;
		params.modules = ['price'];

		this.debug(`Fetching quotes for symbols ${params.symbols.join(',')}`);

		let data = await yahoo.quote(params);
		let quotes = {};

		symbols.forEach((symbol) => {
			let {quoteType:type, currency:currency, marketState:market, regularMarketChangePercent:change, regularMarketTime:date, regularMarketPrice:price, shortName:name} = data[symbol].price;

			let quote = {date:date, symbol:symbol, name:name, type:type, currency:currency, market:market, change:change * 100, price:price};

			// Round change in percent
			quote.change = Math.floor(quote.change * 10 + 0.5) / 10;
			quote.price = Math.floor(quote.price * 100 + 0.5) / 100;

			quotes[symbol] = quote;
		});

		return quotes;

	}

	async fetch() {

		let symbols = [];

		for (let [name, symbol] of Object.entries(this.equities)) {
			symbols.push(symbol);
		}

		let quotes = await this.fetchQuotes(symbols); 

		for (const [name, symbol] of Object.entries(this.equities)) {
			let quote = quotes[symbol];

			if (this.cache[symbol] == undefined || this.cache[symbol].date < quote.date) {
				this.publish(`${this.argv.topic}/${name}`, quote);
				this.cache[symbol] = quote;
			}

		}

	}	

	async loop() {
		try {
			await this.fetch();
		}
		catch (error) {
			this.log(error);
		}
		finally {
			setTimeout(this.loop.bind(this), 1000 * 60 * this.argv.interval);
		}
	}

	publish(topic, value) {
		value = JSON.stringify(value);
		this.debug(`Publishing ${topic}:${value}`);
		this.mqtt.publish(topic, value, {retain:true});
	}

	async run() {
		try {
			var argv = this.argv;

			this.mqtt = MQTT.connect(argv.host, {username:argv.username, password:argv.password, port:argv.port});
			
			this.mqtt.on('connect', () => {
				this.debug(`Connected to host ${argv.host}:${argv.port}.`);
			});

			this.loop();
			
		}
		catch(error) {
			console.error(error.stack);
		}

	}

}


new App().run();



