#!/usr/bin/env node

var yahoo = require('yahoo-finance');
var Events  = require('events');
var Timer = require('yow/timer');
var MQTT = require('mqtt-ex');


require('dotenv').config();
require('yow/prefixConsole')();

class App {

	constructor() {
		var yargs = require('yargs');

		yargs.usage('Usage: $0 [options]')

		yargs.option('help',     {alias:'h', describe:'Displays this information'});
		yargs.option('host',     {describe:'Specifies MQTT host', default:process.env.MQTT_HOST});
		yargs.option('password', {describe:'Password for MQTT broker', default:process.env.MQTT_PASSWORD});
		yargs.option('username', {describe:'User name for MQTT broker', default:process.env.MQTT_USERNAME});
		yargs.option('port',     {describe:'Port for MQTT', default:process.env.MQTT_PORT});
		yargs.option('topic',    {describe:'MQTT root topic', default:process.env.MQTT_TOPIC});
		yargs.option('debug',    {describe:'Debug mode', type:'boolean', default:process.env.DEBUG == '1'});

		yargs.help();
		yargs.wrap(null);

		yargs.check(function(argv) {
			return true;
		});

		this.argv    = yargs.argv;
		this.log     = console.log;
		this.debug   = this.argv.debug ? this.log : () => {};
		this.quotes  = {};
		this.config  = {};
		this.timer   = new Timer();
		this.entries = {};

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
			var {quoteType:type, currency:currency, marketState:state, regularMarketChangePercent:change, regularMarketTime:time, regularMarketPrice:price, shortName:name} = data[symbol].price;

			var quote = {symbol:symbol, type:type, currency:currency, state:state, change:change * 100, price:price, name:name, time:time};

			// Round change in percent
			quote.change = Math.floor(quote.change * 10 + 0.5) / 10;
			quote.price = Math.floor(quote.price * 100 + 0.5) / 100;

			quotes[symbol] = quote;
		});

		return quotes;

	}

	async fetch() {

		let symbols = [];

		Object.keys(this.entries).forEach((name) => {
			symbols.push(this.entries[name].symbol);
		});

		this.quotes = await this.fetchQuotes(symbols); 

	}


	async loop() {
		await this.fetch();	 
		setTimeout(this.loop.bind(this), 1000 * 60 * 15);
	}

	publish(topic, value) {
		value = JSON.stringify(value);
		this.debug(`Publishing ${topic}:${value}`);
		this.mqtt.publish(topic, value, {retain:true});
	}


	publishQuotes() {

		Object.keys(this.entries).forEach((name) => {
			let entry = this.entries[name];
			let quote = this.quotes[entry.symbol];

			if (quote != undefined) {
				if (entry.quote == undefined || JSON.stringify(entry.quote) != JSON.stringify(quote)) {

					this.debug(`Symbol ${entry.symbol} changed.`);

					Object.keys(quote).forEach((key) => {
						this.publish(`${this.argv.topic}/${name}/${key}`, quote[key]);
					});

					entry.quote = quote;
				}
			}
		});
	}


	async run() {
		try {
			var argv = this.argv;

			this.mqtt = MQTT.connect(argv.host, {username:argv.username, password:argv.password, port:argv.port});
			
			this.mqtt.on('connect', () => {
				this.log(`Connected to host ${argv.host}:${argv.port}.`);
			});

			this.mqtt.subscribe(`${this.argv.topic}/+`);

			this.mqtt.on(`${this.argv.topic}/:name`, (topic, message, args) => {

				try {
					if (message == '') {
						this.log(`Removed symbol ${args.name}.`);
						delete this.entries[args.name];
					}
					else {
						try {
							let config = JSON.parse(message);
							this.log(`Added symbol ${args.name}:${JSON.stringify(config)}...`);
							this.entries[args.name] = {symbol:config.symbol, name:args.name, quote:{}};

							this.timer.setTimer(2000, async () => {
								await this.fetch();
								this.publishQuotes();
							});
						}
						catch(error) {
							throw new Error(`Invalid configuration "${message}".`);
						}
					}
				}
				catch(error) {
					this.log(error);
				}

			});

			this.loop();
			
		}
		catch(error) {
			console.error(error.stack);
		}

	}

}


new App().run();



