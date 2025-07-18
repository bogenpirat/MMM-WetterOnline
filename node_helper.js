const Log = require("logger");
const NodeHelper = require("node_helper");

module.exports = NodeHelper.create({
	async socketNotificationReceived(notification, payload) {
		if (notification === "WETTERONLINE_REFRESH") {
			await this.updateWOTrend(payload.city, payload.userAgent);
		}
	},

	async updateWOTrend(city, userAgent) {
		let url = `https://www.wetteronline.de/wetter/${city}`;
		let body = await this.getUrl(url, userAgent);
		let gid = this.findGid(city, body);

		if (gid) {
			const WO_DAILY_URL = `https://api-app.wetteronline.de/app/weather/forecast?av=2&mv=13&c=d2ViOmFxcnhwWDR3ZWJDSlRuWeb=&location_id=${gid}&timezone=${process.env.TZ}`;
			let daily_promise = await this.getUrl(WO_DAILY_URL, userAgent);
			let dailyData = JSON.parse(await daily_promise);

			const WO_HOURLY_URL = `https://api-app.wetteronline.de/app/weather/hourcast?av=2&mv=13&c=d2ViOmFxcnhwWDR3ZWJDSlRuWeb=&location_id=${gid}&timezone=${process.env.TZ}`;
			let hourly_promise = await this.getUrl(WO_HOURLY_URL, userAgent);
			let hourlyData = JSON.parse(await hourly_promise);

			let event = this.extractEvent(dailyData, hourlyData, body);

			this.getHelper().sendSocketNotification("WETTERONLINE_RESULTS", event);
		}
	},

	findGid(city, body) {
		const exp = /gid : "([^"]+)"/s;
		const match = body.match(exp);

		if (match) {
			const gid = match[1];
			Log.debug(`MMM-WetterOnline: The gid of city "${city}" is ${gid}.`)
			return gid;
		} else {
			Log.error(`MMM-WetterOnline: The gid of city "${city}" could not be extracted.`);
		}
	},

	extractSymbolUrl(body) {
		const symbolUrlBaseMatcher = body.match(/<base href="([^"]+)" >/);
		let symbolUrlBase = "https://www.wetteronline.de";
		if (symbolUrlBaseMatcher && symbolUrlBaseMatcher[1]) {
			symbolUrlBase += symbolUrlBaseMatcher[1];
		}
		let symbolUrlMatcher = body.match(/<img[^>]+class="symbol"[^>]+src="([^"]+\/)[^"\/]+"/ms);
		if (symbolUrlMatcher && symbolUrlMatcher[1]) {
			return symbolUrlBase + symbolUrlMatcher[1];
		} else {
			Log.warn("Could not extract symbol base URL from body, using default.");
			return "https://www.wetteronline.de/www-m3-ng-assets/assets/weather-symbol/";
		}
	},

	extractEvent(dailyData, hourlyData, body) {
		// extract current temp
		let currentTempMatch = body.match(/<span[^>]+class="air-temp">\s*(-?\d+)°\s*<\/span>/ms);
		let currTemp = currentTempMatch ? currentTempMatch[1] : null;

		// extract url patterns
		let dailiesSymbolUrl = hourliesSymbolUrl = this.extractSymbolUrl(body);

		// generate hourlies
		let hourlies = [];
		hourlyData["hours"].forEach(hourlyForecast => {
			hourlies.push({
				symbol: hourlyForecast["symbol"],
				temperature: Math.round(hourlyForecast["temperature"]["air"]),
				wind_speed_kmh: hourlyForecast["wind"]["speed"]["kilometer_per_hour"]["value"],
				air_pressure: {
					hpa: Math.round(hourlyForecast["air_pressure"]["hpa"]),
					inhg: (hourlyForecast["air_pressure"]["inhg"]).toFixed(2),
					mmhg: Math.round(hourlyForecast["air_pressure"]["mmhg"])
				}
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
				day_time_label: new Date(dailyForecast["sun"]["rise"]).toLocaleDateString(new Intl.NumberFormat().resolvedOptions().locale, { weekday: "short" }),
				sunhours: Math.round(dailyForecast["sun"]["duration"]["absolute"]),
				air_pressure: {
					hpa: Math.round(dailyForecast["air_pressure"]["hpa"]),
					inhg: (dailyForecast["air_pressure"]["inhg"]).toFixed(2),
					mmhg: Math.round(dailyForecast["air_pressure"]["mmhg"])
				}
			});
		});

		// extract current conditions
		let currentCondMatch = body.match(/WO\.metadata\.p_city_weather\.nowcastBarMetadata = (\{.+\})$/m);
		let currentWeatherMatch = body.match(/<span class="gust\s*">\s*(\S+) (\d+) km\/h\s*<\/span>/ms);

		let currConditions = {
			symbol_text: currentCondMatch ? JSON.parse(currentCondMatch[1])["nowcastBar"][0]["text"] : "",
			wind_speed_text: currentWeatherMatch ? currentWeatherMatch[1] : "",
			wind_speed_kmh: currentWeatherMatch ? currentWeatherMatch[2] : "",
			air_pressure: hourlyData["hours"][0]["air_pressure"]
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
			debug: currentCondMatch ? currentCondMatch[1] : null
		};
	},

	getHelper() {
		return this;
	},

	getUrl(myUrl, userAgent) {
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

	parseInlineJson(str) {
		return eval?.(`"use strict";(${str})`);
	}
});