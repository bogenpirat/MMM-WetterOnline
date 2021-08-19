const http = require('https');
const url = require('url');
const cheerio = require('cheerio');
const NodeHelper = require('node_helper');

module.exports = NodeHelper.create({
	
	socketNotificationReceived: function(notification, payload) {
		if(notification  == "WETTERONLINE_REFRESH") {
			this.updateWOTrend(payload.city, payload.userAgent);
		}
	},

	
	updateWOTrend: function(city, userAgent) {
		const WO_TREND_URL = url.parse("https://www.wetteronline.de/wetter/" + city);
		
		var helper = this;
		var opts = this.makeOpts(WO_TREND_URL, userAgent);
		var req = http.request(opts, function(res) {
			var data = [];
			
			res.on('data', function(chunk) {
				data.push(chunk);
			}).on('end', function() {
				var buffer = Buffer.concat(data);
				var websiteCode = buffer.toString();
            
				// CURRENT CONDITIONS
	
				const $ = cheerio.load(websiteCode);
				var currTemp = $("#current-temp").text().replace(/[^\d\-]*/g, '').trim();

				var currConditions = {
					symbol_text: $("#ambient-station-weather table tr").eq(0).find("td").eq(1).contents().filter(function() {
							return this.type === 'text';
						}).text().trim(),
					wind_speed_text: $("#ambient-station-weather table tr").eq(0).find("span.wind").text().trim(),
					wind_speed_kmh: parseFloat($("#ambient-station-weather table tr").eq(0).find("span.gust").text().replace(/[^\d\-\.,]*/g, '').trim()) || 0,
				};
	
				// HOURLY FORECAST
	
				var hourlyEls = $(".hour");
				var hourlies = [];
				hourlyEls.each(function(i, hourlyEl) {
					if(hourlyEl.attribs['data-wo-details']) {
						var hJson = JSON.parse(hourlyEl.attribs['data-wo-details']);
						hourlies.push(hJson);
						var testImg = $("img", hourlyEl).get(0);
						if(testImg.attribs['src']) {
							hourliesSymbolUrl = testImg.attribs['src'].replace(/(.*\/)[^\/]*/, '$1');
						}
					}
				});
            
				// DAILY FORECAST
				
				var dailies = [];
				var dailyEls = $(".day");
				dailyEls.each(function(i, dailyEl) {
					if(dailyEl.attribs['data-wo-details']) {
						var dJson = JSON.parse(dailyEl.attribs['data-wo-details']);
						
						var high = $(".max-temp", dailyEl).text().replace(/[^\d\-]*/g, '').trim();
						var low = $(".min-temp", dailyEl).text().replace(/[^\d\-]*/g, '').trim();
						dJson.high = parseInt(high);
						dJson.low = parseInt(low);
						
						dailies.push(dJson);
						var testImg = $("img", dailyEl).get(0);
						if(testImg.attribs['src']) {
							dailiesSymbolUrl = testImg.attribs['src'].replace(/(.*\/)[^\/]*/, '$1');
						}
					}
				});
            
				// SIGNAL DATA
				const notif = {
					currentTemp: currTemp,
					currConditions: currConditions,
					hourlies: hourlies,
					dailies: dailies,
					symbolUrls: {
						dailies: dailiesSymbolUrl,
						hourlies: hourliesSymbolUrl
					}
				};
				helper.sendSocketNotification("WETTERONLINE_RESULTS", notif);
			});
		});

		req.end();
	},
	
	makeOpts: function(myUrl, userAgent) {
		myUrl = myUrl;
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
	}
});