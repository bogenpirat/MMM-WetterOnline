const http = require('https');
const URL = require('url');
const cheerio = require('cheerio');
const NodeHelper = require('node_helper');

module.exports = NodeHelper.create({
	
	socketNotificationReceived: async function(notification, payload) {
		if(notification  == "WETTERONLINE_REFRESH") {
			await this.updateWOTrend(payload.city, payload.userAgent);
		}
	},

	
	updateWOTrend: async function(city, userAgent) {
		let url = URL.parse(`https://www.wetteronline.de/wetter/${city}`);
        let body = await this.getUrl(url, userAgent);
        let gid = this.findGid(body);

        const WO_DAILY_URL = URL.parse(`https://api-app.wetteronline.de/app/weather/forecast?av=2&mv=13&c=d2ViOmFxcnhwWDR3ZWJDSlRuWeb=&location_id=${gid}&timezone=${process.env.TZ}`)
        let daily_promise = await this.getUrl(WO_DAILY_URL, userAgent);
        let dailyData = JSON.parse(await daily_promise);

        const WO_HOURLY_URL = URL.parse(`https://api-app.wetteronline.de/app/weather/hourcast?av=2&mv=13&c=d2ViOmFxcnhwWDR3ZWJDSlRuWeb=&location_id=${gid}&timezone=${process.env.TZ}`)
        let hourly_promise = await this.getUrl(WO_HOURLY_URL, userAgent);
        let hourlyData = JSON.parse(await hourly_promise);

		let event = this.extractEvent(dailyData, hourlyData, body);
		
		this.getHelper().sendSocketNotification("WETTERONLINE_RESULTS", event);
	},

	findGid: function(body) {
		const exp = /WO\.geo = (\{[^\}]+\})/m;
	
		const match = body.match(exp);
	
		if(match) {
			let obj = this.parseInlineJson(match[1]);
			return obj['gid'];
		}
	
		throw new Error("city's gid could not be extracted");
	},

	extractEvent: function(dailyData, hourlyData, body) {
		// extract current temp
		let currentTempMatch = body.match(/<div id="nowcast-card-temperature"[^>]*>.*?<div class="value">(\d+)<\/div>/ms);
		let currTemp = currentTempMatch ? currentTempMatch[1] : null;
	
		// extract url patterns
		let symbolUrlMatch = body.match(/<span class="daylabel">[^<]*<\/span>\s*<img src="([^"]+)\/[^\/]+"/ms);
		let dailiesSymbolUrl = hourliesSymbolUrl = symbolUrlMatch ? symbolUrlMatch[1] + "/" : null;
	
		// generate hourlies
		let hourlies = [];
		hourlyData['hours'].forEach(hourlyForecast => {
			hourlies.push({
				symbol: hourlyForecast['symbol'],
				temperature: Math.round(hourlyForecast['temperature']['air']),
				wind_speed_kmh: hourlyForecast['wind']['speed']['kilometer_per_hour']['value'],
			});
		});
	
		// generate dailies
		let dailies = [];
		dailyData.forEach(dailyForecast => {
			dailies.push({
				symbol: dailyForecast['symbol'],
				high: Math.round(dailyForecast['temperature']['max']['air']),
				low: Math.round(dailyForecast['temperature']['min']['air']),
				pop: Math.round(dailyForecast['precipitation']['probability'] * 100),
				// dirty hack - sunrise is usually ON the day (b/c offsets)
				day_time_label: new Date(dailyForecast["sun"]["rise"]).toLocaleDateString(new Intl.NumberFormat().resolvedOptions().locale, {weekday: 'short'}),
			});
		});
		
		// extract current conditions
		let currentCondMatch = body.match(/WO\.metadata\.p_city_weather\.nowcastBarMetadata = (\{.+\})$/m);
		let firstHourlyMatch = body.match(/hourlyForecastElements\.push\((\{[^}]+\})/ms);
		let currConditions = {
			symbol_text: currentCondMatch ? JSON.parse(currentCondMatch[1])['nowcastBar'][0]['text'] : null,
			wind_speed_text: firstHourlyMatch ? this.parseInlineJson(firstHourlyMatch[1])['windSpeedText'] : null,
			wind_speed_kmh: firstHourlyMatch ? this.parseInlineJson(firstHourlyMatch[1])['windSpeedKmh'] : null,
		};
	
		
		return {
			currentTemp: currTemp,
			currConditions: currConditions,
			hourlies: hourlies,
			dailies: dailies,
			symbolUrls: {
				dailies: dailiesSymbolUrl,
				hourlies: hourliesSymbolUrl
			},
			debug: currentCondMatch[1]
		};
	},
	
	makeOpts: function(myUrl, userAgent) {
		myUrl = URL.parse(myUrl);
		return {
			host: myUrl.hostname,
			path: myUrl.path,
			port: 443,
			timeout: 5000,
			headers: {
				'User-Agent': userAgent
			},
			method: 'GET'
		};
	},

	storeData: function(fname, data) {
		require('fs').writeFileSync(fname, data, function(err) {
				if(err) {
					console.log(err);
				}
		});
	},

	getHelper: function() {
		return this;
	},

	getUrl: function(myUrl, userAgent) {
		let opts = this.makeOpts(myUrl, userAgent);
		
		return new Promise((resolve, reject) => {
			let req = http.request(opts, (res) => {
				var data = [];
				
				res.on('data', (chunk) => {
					data.push(chunk);
				});
				
				res.on('end', () => {
					let body = Buffer.concat(data);
					resolve(body.toString());
				});
	
				res.on('error', (error) => {
					reject(error);
				});
			});
	
			req.end();
		});
	},

	parseInlineJson: function(str) {
		return eval?.(`"use strict";(${str})`);
	},
});