const NodeHelper = require("node_helper");

module.exports = NodeHelper.create({
	async socketNotificationReceived (notification, payload) {
		if (notification === "WETTERONLINE_REFRESH") {
			await this.updateWOTrend(payload.city, payload.userAgent);
		}
	},

	async updateWOTrend (city, userAgent) {
		let url = `https://www.wetteronline.de/wetter/${city}`;
        let body = await this.getUrl(url, userAgent);
        let gid = this.findGid(body);

        const WO_DAILY_URL = `https://api-app.wetteronline.de/app/weather/forecast?av=2&mv=13&c=d2ViOmFxcnhwWDR3ZWJDSlRuWeb=&location_id=${gid}&timezone=${process.env.TZ}`;
        let daily_promise = await this.getUrl(WO_DAILY_URL, userAgent);
        let dailyData = JSON.parse(await daily_promise);

        const WO_HOURLY_URL = `https://api-app.wetteronline.de/app/weather/hourcast?av=2&mv=13&c=d2ViOmFxcnhwWDR3ZWJDSlRuWeb=&location_id=${gid}&timezone=${process.env.TZ}`;
        let hourly_promise = await this.getUrl(WO_HOURLY_URL, userAgent);
        let hourlyData = JSON.parse(await hourly_promise);

		let event = this.extractEvent(dailyData, hourlyData, body);
		
		this.getHelper().sendSocketNotification("WETTERONLINE_RESULTS", event);
	},

	findGid (body) {
		const exp = /WO\.geo = (\{[^\}]+\})/m;
	
		const match = body.match(exp);
	
		if(match) {
			let obj = this.parseInlineJson(match[1]);
			return obj["gid"];
		}
	
		throw new Error("city's gid could not be extracted");
	},

	extractEvent (dailyData, hourlyData, body) {
		// extract current temp
		let currentTempMatch = body.match(/<div id="nowcast-card-temperature"[^>]*>.*?<div class="value">(-?\d+)<\/div>/ms);
		let currTemp = currentTempMatch ? currentTempMatch[1] : null;
	
		// extract url patterns
		let symbolUrlMatch = body.match(/<span class="daylabel">[^<]*<\/span>\s*<img src="([^"]+)\/[^/]+"/ms);
		let dailiesSymbolUrl = hourliesSymbolUrl = symbolUrlMatch ? `${symbolUrlMatch[1]}/` : null;
	
		// generate hourlies
		let hourlies = [];
		hourlyData["hours"].forEach(hourlyForecast => {
			hourlies.push({
				symbol: hourlyForecast["symbol"],
				temperature: Math.round(hourlyForecast["temperature"]["air"]),
				wind_speed_kmh: hourlyForecast["wind"]["speed"]["kilometer_per_hour"]["value"]
			});
		});
	
		// generate dailies
		let dailies = [];
		dailyData.forEach(dailyForecast => {
			dailies.push({
				symbol: dailyForecast["symbol"],
				high: Math.round(dailyForecast["temperature"]["max"]["air"]),
				low: Math.round(dailyForecast["temperature"]["min"]["air"]),
				pop: Math.round(dailyForecast["precipitation"]["probability"] * 100),
				// dirty hack - sunrise is usually ON the day (b/c offsets)
				day_time_label: new Date(dailyForecast["sun"]["rise"]).toLocaleDateString(new Intl.NumberFormat().resolvedOptions().locale, {weekday: "short"})
			});
		});
		
		// extract current conditions
		let currentCondMatch = body.match(/WO\.metadata\.p_city_weather\.nowcastBarMetadata = (\{.+\})$/m);
		let firstHourlyMatch = body.match(/hourlyForecastElements\.push\((\{[^}]+\})/ms);
		let currConditions = {
			symbol_text: currentCondMatch ? JSON.parse(currentCondMatch[1])["nowcastBar"][0]["text"] : null,
			wind_speed_text: firstHourlyMatch ? this.parseInlineJson(firstHourlyMatch[1])["windSpeedText"] : null,
			wind_speed_kmh: firstHourlyMatch ? this.parseInlineJson(firstHourlyMatch[1])["windSpeedKmh"] : null
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
	
	getHelper () {
		return this;
	},

	getUrl (myUrl, userAgent) {
		return fetch(myUrl, {
			headers: {
				"User-Agent": userAgent
			}
		})
			.then(response => response.text())
			.catch(error => {
				throw new Error(error);
		});
	},

	parseInlineJson (str) {
		return eval?.(`"use strict";(${str})`);
	}
});