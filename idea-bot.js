'use strict';

const Botkit = require('botkit');
const os = require('os');
const request = require('request');
const cheerio = require('cheerio');
const GoogleSpreadsheet = require('google-spreadsheet');
const async = require('async');

function getConfig() {
  return process.env.NODE_ENV === 'production' ? process.env : require('./secrets.js');
}

const config = getConfig();
const googleCreds = { client_email: config.SHEETS_EMAIL, private_key: config.SHEETS_PRIVATE_KEY };

function addToSheet(doc, row, tag, callback) {
  doc.getInfo((err, info) => {
    if (err) {
      console.log('google sheets error:' + err);
    }
    const sheetNum = sheetNumber(info.worksheets, tag);
    if (sheetNum === 0) {
      doc.addWorksheet({ title: tag, headers: ['url', 'pageTitle', 'description'] }, function(sheet) {
        doc.addRow(sheetNumber(info.worksheets, tag), row, callback);
      });
    }
    else {
      console.log('adding to row');
      doc.addRow(sheetNum, row, callback);
    }
  });
}

function sheetNumber(sheets, sheetTag) {
  // For whatever reason, the sheets API requires one to
  // operate on the doc as a 1-indexed collection.
  return 1 + sheets.findIndex(sheet => {
    return sheet.title.toLowerCase() === sheetTag.toLowerCase();
  });
}

function scrape(url, callback) {
  console.log('requesting url: ' + url);
  const options = {
    url: url,
    headers: {
      'User-Agent': 'curl/7.35.0',
      'Accept': '*/*'
    }
  };
  request(options, function(error, response, body) {
    console.log('Request status: ' + response.statusCode + ', body: ' + body);
    if (!error && response.statusCode == 200) {
      console.log('parsing html');
      const html = cheerio.load(body);
      console.log('html parsed, adding to spreadsheet');
      return callback({
        pageTitle: extractMetaTagContent(html, 'title'),
        description: extractMetaTagContent(html, 'description')
      });
    }
    else {
      console.log('Error: ' + error);
    }
  })
}

function extractMetaTagContent(html, tagName) {
  return parseOgMetaTag(html, tagName) || parseStandardMetaTag(html, tagName);
}

function parseOgMetaTag(html, tagName) {
  return html(`meta[property="og:${tagName}"]`).attr('content');
}

function parseStandardMetaTag(html, tagName) {
  return html(`meta[name="${tagName}"]`).attr('content');
}

let doc = new GoogleSpreadsheet(config.SHEET_KEY);

let controller = Botkit.slackbot();

let bot = controller.spawn({ token: config.SLACK_TOKEN }).startRTM();

// Start a server to listen for webhooks from Slack. Not implemented at the moment.
// controller.setupWebserver(process.env.PORT || 3001, function(err, webserver) {
//   controller.createWebhookEndpoints(webserver, bot, function() {
//     // something here later
//   });
// });

controller.hears(['^#([^ ]*) <([^ ]*)>'], 'direct_message,direct_mention,mention', function(bot, message) {
  let tag = message.match[1];
  let url = message.match[2];
  async.series([
    function(step) {
      console.log('Google auth step');
      doc.useServiceAccountAuth(googleCreds, step);
    },
    function(step) {
      console.log('Authenticated, scraping URL now');
      scrape(url, step);
    },
    function(result, step) {
      console.log('URL scraped, adding to sheet');
      let row = {
        pageTitle: result.pageTitle,
        description: result.description,
        url: url
      };
      addToSheet(doc, row, tag, step);
    },
    function(err) {
      if (err) {
        bot.reply(message, "adding " + url + " to spreadsheet " + tag + " FAILED! Error: " + err);
      } else {
        bot.reply(message, "added " + url + " to spreadsheet " + tag);
      }
    }
  ]);
});
