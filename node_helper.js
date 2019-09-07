const http = require('https');
const url = require('url');
const nhp = require('node-html-parser');
const NodeHelper = require('node_helper');

module.exports = NodeHelper.create({
	
	socketNotificationReceived: function(notification, payload) {
		if(notification  == "WETTERONLINE_REFRESH") {
			this.updateWOTrend(payload.city, payload.userAgent);
		}
	},

	
	updateWOTrend: function(city, userAgent) {
		const WO_TREND_URL = url.parse("https://www.wetteronline.de/wettertrend/" + city);
		
		var helper = this;
		var opts = this.makeOpts(WO_TREND_URL, userAgent);
		var req = http.request(opts, function(res) {
			var data = [];
			
			res.on('data', function(chunk) {
				data.push(chunk);
			}).on('end', function() {
				var buffer = Buffer.concat(data);
				var websiteCode = buffer.toString();
				
				const root = nhp.parse(websiteCode, {script: true, style: false});
				var currTemp = root.querySelector("#current-temp").text.replace(/[^\d\-]*/g, '').trim();
				
				var currConditions = JSON.parse(root.querySelector("#current-weather").attributes['data-tt-args']);
				//console.log("conditions: " + Object.keys(currConditions).length);
				
				var hourlyEls = root.querySelector("#hourly-elements").childNodes;
				var hourlies = [];
				for(var i = 0; i < hourlyEls.length; i++) {
					if(hourlyEls[i].nodeType == 1 && hourlyEls[i].attributes && hourlyEls[i].attributes['data-tt-args']) {
						var hJson = JSON.parse(hourlyEls[i].attributes['data-tt-args']);
						hourlies.push(hJson);
						var testImg = hourlyEls[i].querySelector("img");
						if(testImg && testImg.attributes && testImg.attributes['src']) {
							hourliesSymbolUrl = testImg.attributes['src'].replace(/(.*\/)[^\/]*/, '$1');
						}
					}
				}
				//console.log("hourlies: " + hourlies.length);
				
				var geo = {};
				var toks = websiteCode.split(/WO\.geo = /);
				if(toks.length == 2) {
					toks = toks[1].split(/};/);
					geo = JSON.parse(helper.fixJson(toks[0] + '}'));
				}
				//console.log("geo: " + Object.keys(geo).length);
				
				var dailies = [];
				var dailyEls = root.querySelector("#daily_weather_wrapper").childNodes;
				for(var i = 0; i < dailyEls.length; i++) {
					if(dailyEls[i].nodeType == 1 && dailyEls[i].attributes && dailyEls[i].attributes['data-tt-args']) {
						var dJson = JSON.parse(dailyEls[i].attributes['data-tt-args']);
						
						var high = dailyEls[i].querySelector(".daily.temperatures").childNodes[1].querySelector(".temp").text.replace(/[^\d\-]*/g, '').trim();
						var low = dailyEls[i].querySelector(".daily.temperatures").childNodes[3].querySelector(".temp").text.replace(/[^\d\-]*/g, '').trim();
						dJson.high = parseInt(high);
						dJson.low = parseInt(low);
						
						var suntime = dailyEls[i].querySelector(".suntimes").text.replace(/[^\d]*/g, '').trim();
						var pop = dailyEls[i].querySelector(".pop").text.replace(/[^\d]*/g, '').trim(); // probability of precipitation
						dJson.suntime = parseInt(suntime);
						dJson.pop = parseInt(pop);
						
						dailies.push(dJson);
						var testImg = dailyEls[i].querySelector("img");
						if(testImg && testImg.attributes && testImg.attributes['src']) {
							dailiesSymbolUrl = testImg.attributes['src'].replace(/(.*\/)[^\/]*/, '$1');
						}
					}
				}
				//console.log("dailies: " + dailies.length);
				
				helper.sendSocketNotification("WETTERONLINE_RESULTS", {
					currentTemp: currTemp, 
					currConditions: currConditions, 
					geo: geo, 
					hourlies: hourlies,
					dailies: dailies,
					symbolUrls: {
						dailies: dailiesSymbolUrl,
						hourlies: hourliesSymbolUrl
					}
				});
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
	},

	fixJson: function(inText) {
		var outText = inText.replace(/([_a-zA-Z0-9]+)\s*:/g, '"$1":');
		outText = outText.replace(/btoa\("[^"]*"\)/g, '"' + Buffer.from("$1").toString('base64') + '"');
		return outText;
	}
});