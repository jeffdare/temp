/**
 * Copyright 2015 IBM Corp. All Rights Reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

'use strict';

var express  = require('express'),
  app        = express(),
  fs         = require('fs'),
  path       = require('path'),
  bluemix    = require('./config/bluemix'),
  extend     = require('util')._extend,
  watson     = require('watson-developer-cloud'),
  ibmiotf    = require('ibmiotf');

// Bootstrap application settings
require('./config/express')(app);

//for conversing with the dialog service
var DISPLAY_SENSOR_VALUE = "DISPLAY SENSOR VALUE";
var DISPLAY_NO_DEVICE = "DISPLAY NO DEVICE";

// if bluemix credentials exists, then override local
var credentials =  extend({
  url: 'https://gateway.watsonplatform.net/dialog/api',
  username: '2e9c813d-9334-4a40-8d3e-5579bc6fbc76',
  password: 'sl7EASPJfkQz',
  version: 'v1'
}, bluemix.getServiceCreds('dialog')); // VCAP_SERVICES

// if bluemix credentials exists, then override local
var iotCredentials = extend({
  org: 'ld95lc',
  id: ''+Date.now(),
  "auth-key": 'a-ld95lc-ja0xe12jro',
  "auth-token": '&r4I0+0AovhFGa@Z?Z'
}, bluemix.getIoTServiceCreds());


var dialog_id_in_json = (function() {
  try {
    var dialogsFile = path.join(path.dirname(__filename), 'dialogs', 'dialog-id.json');
    var obj = JSON.parse(fs.readFileSync(dialogsFile));
    return obj[Object.keys(obj)[0]].id;
  } catch (e) {
  }
})();

//Watson IoT devices
var devices = {};
//device events
var temps;

var appClient = new ibmiotf.IotfApplication(iotCredentials);

appClient
.getAllDevices().then (function onSuccess (argument) {
  console.log("Success");
  console.log(argument);
  var deviceResults = argument.results;
  devices = {};
  deviceResults.forEach(function (device) {
    devices[device.deviceId] = device;
  });

}, function onError (argument) {
  
  console.log("Fail");
  console.log(argument);
});

// Create the service wrapper
var dialog = watson.dialog(credentials);
//var dialog_id = process.env.DIALOG_ID || dialog_id_in_json || '6752b0f4-7d8b-4237-a9fc-b323953312e9';
var dialog_id = process.env.DIALOG_ID || dialog_id_in_json /*|| 'bbe01ff1-296e-48cc-a38c-e96f046a6bcf'*/;

//create the dialog
/*var fullPath = "./dialogs/temp.xml";
var params = {
  dialog_id : dialog_id,
  file : fs.createReadStream(fullPath)
};

dialog.updateDialog(params, function(error, response, body) {

  console.log("resp  : "+JSON.stringify(response));
  console.log("error  : "+error);
  console.log("body  : "+JSON.stringify(body));
});*/

app.post('/conversation', function(req, res, next) {
  var params = extend({ dialog_id: dialog_id }, req.body);
  dialog.conversation(params, function(err, results) {
    console.log("results : "+JSON.stringify(results));
    var resultStr = results.response.join(' ');
    if (err){
      return next(err);
    }
    else if(getDevices(resultStr)) {
      results.response = Object.keys(devices);
      res.json({ dialog_id: dialog_id, conversation: results});
    } 
    else if(getDeviceValue(resultStr)) {
      var device = resultStr.split(',')[0];
      var selected = devices[device];
      
      if(selected === undefined){
        var params = extend({ dialog_id: dialog_id }, req.body);
          params.input = DISPLAY_NO_DEVICE;
          dialog.conversation(params, function(err, results) {
            if (err){
              return next(err);
            } 
            else {
              res.json({ dialog_id: dialog_id, conversation: results});
            }
          });
      } else {
        appClient
          .getLastEvents(selected.typeId, selected.deviceId).then (function onSuccess (argument) {
           
            var value = "";
            if(argument !== undefined && argument[0] !== undefined) {
              var payload = JSON.parse(new Buffer(argument[0].payload, 'base64').toString('ascii'));
              
              var temperature = payload.temperature;
              
              if(temperature !== undefined && temperature !== null) {
                value = temperature;
              } else {
                value = "NO";
              }
            } else 
              value = "NO";

            var profile = {
              client_id: req.body.client_id,
              dialog_id: dialog_id,
              name_values: [
                { name:'value', value: value }
              ]
            }; 
            dialog.updateProfile(profile, function(err, results) {
              if (err)
                return next(err);
              
              //call the converse api to get the latest value
              var params = extend({ dialog_id: dialog_id }, req.body);
              params.input = DISPLAY_SENSOR_VALUE;
              dialog.conversation(params, function(err, results) {
                if (err){
                  return next(err);
                } 
                else {
                  res.json({ dialog_id: dialog_id, conversation: results});
                }
              });
            });
          }, function onError (argument) {
            
            console.log("Fail");
            console.log(argument);
        });
      }
    }
    else
      res.json({ dialog_id: dialog_id, conversation: results});
  });
});

app.post('/profile', function(req, res, next) {
  var params = extend({ dialog_id: dialog_id }, req.body);
  dialog.getProfile(params, function(err, results) {
    if (err)
      return next(err);
    else
      res.json(results);
  });
});

// error-handler settings
require('./config/error-handler')(app);

var port = process.env.VCAP_APP_PORT || 3001;
app.listen(port);
console.log('listening at:', port);

//return Devices
function getDevices(results) {
  return results.indexOf('DEVICES') !== -1;
}

//return the temperature value
function getDeviceValue(results) {
  return results.indexOf('VALUE') !== -1;
}