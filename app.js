#!/usr/bin/env node

var yahoo = require('yahoo-finance');
var Events  = require('events');
var Timer = require('yow/timer');
var MQTT = require('mqtt-ex');


require('dotenv').config();


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
		yargs.option('debug',    {describe:'Debug mode', type:'boolean', default:false});

		yargs.help();
		yargs.wrap(null);

		yargs.check(function(argv) {
			return true;
		});

		this.argv    = yargs.argv;
		this.debug   = this.argv.debug ? console.log : () => {};
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
			var {regularMarketChangePercent:change, regularMarketTime:time, regularMarketPrice:price, shortName:name} = data[symbol].price;

			var quote = {symbol:symbol, change:change * 100, price:price, name:name, time:time};

			// Round change in percent
			quote.change = Math.floor(quote.change * 100 + 0.5) / 100;

			quotes[symbol] = quote;
		});

		return quotes;

	}

	async fetch() {

		let symbols = [];

		Object.keys(this.entries).forEach((name) => {
			let entry = this.entries[name];
			symbols.push(this.entries[name].symbol);

		});

		return await this.fetchQuotes(symbols);
	}


	async loop() {
		this.debug(`Updating quotes...`);
		this.quotes = await this.fetch();
		setTimeout(this.loop.bind(this), 1000 * 60 * 5);
	}

	publish(topic, value) {
		value = JSON.stringify(value);
		this.debug(`Publishing ${topic}:${value}`);
		this.mqtt.publish(topic, value, {retain:true});
	}

	async update() {

		this.quotes = await this.fetch();

		Object.keys(this.entries).forEach((name) => {
			let entry = this.entries[name];
			let quote = this.quotes[entry.symbol];

			if (quote != undefined) {
				if (entry.quote == undefined || entry.quote.price != quote.price) {

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
				this.debug(`Connected to host ${argv.host}:${argv.port}.`);
			});

			this.mqtt.subscribe(`${this.argv.topic}/+`);

			this.mqtt.on(`${this.argv.topic}/:name`, (topic, message, args) => {

				try {
					if (message == '') {
						this.debug(`Removed topic ${topic}...`);
						delete this.entries[args.name];
					}
					else {
						try {
							let config = JSON.parse(message);
							this.entries[args.name] = {symbol:config.symbol, name:args.name, quote:{}};

							this.timer.setTimer(1000, () => {
								this.update();
							})
						}
						catch(error) {
							throw new Error(`Invalid configuration "${message}".`);
						}
		
	
					}

	
				}
				catch(error) {
					this.debug(error);
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


