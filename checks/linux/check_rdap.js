/*!
 * NodePing
 * Copyright(c) 2025 NodePing LLC
 */

/*!
 * check_rdap.js
 * RDAP server check for NodePing AGENT
 */

/**
 *  static config.
 **/
var config = {
    debug: false,              // whether we're showing debug messages
    timeout:10000              // Can be overriden by a parameter
};

var resultobj = require('../results.js');
var sys = require('util');
var net = require('net');
var dns = require('dns');
var nputil = require('../../nputil.js');
var rootInfo = {domains:{}};

var logger = console;

var check = exports.check = function(jobinfo, retry) {
    //logger.log('info',"check_rdap: Jobinfo passed to RDAP check: "+sys.inspect(jobinfo));
    retry = retry || 0;
    var targetIsIp;
    var targetIsAsn;
    var defaulttimeout = config.timeout * 1;
    var timeout = config.timeout * 1;
    if (jobinfo.parameters.threshold) {
        defaulttimeout = 1000 * parseInt(jobinfo.parameters.threshold);
        if (defaulttimeout > 90000) defaulttimeout = 90000;
        timeout = defaulttimeout + 1000;
    }
    debugMessage('info',"check_rdap: Jobinfo passed: "+sys.inspect(jobinfo));
    if (!jobinfo.results || typeof jobinfo.results === 'string') { // rechecks come in with results set to a string.
        jobinfo.results = {start:new Date().getTime()};
    }
    if (retry && retry > 10) {
        debugMessage('info',"check_rdap: Too many retries "+retry.toString());
        jobinfo.results.end = new Date().getTime();
        jobinfo.results.runtime = jobinfo.results.end - jobinfo.results.start;
        jobinfo.results.success = false;
        jobinfo.results.statusCode = 'error';
        jobinfo.results.message = 'Too many retries';
        resultobj.process(jobinfo, true);
        return true;
    }
    if (jobinfo.redirectstart) {
        // Set start from before the redirect
        jobinfo.results.start =  jobinfo.redirectstart;
        delete jobinfo.redirectstart
    }
    jobinfo.results.message = '';
    if (!retry) {
        if (jobinfo.targetip) {
            delete jobinfo.targetip;
        }
        if (jobinfo.redirecttarget) {
            delete jobinfo.redirecttarget;
        }
    }
    if (!jobinfo.parameters.target) {
        debugMessage('info',"check_rdap: Invalid query");
        jobinfo.results.end = new Date().getTime();
        jobinfo.results.runtime = jobinfo.results.end - jobinfo.results.start;
        jobinfo.results.success = false;
        jobinfo.results.statusCode = 'error';
        jobinfo.results.message = 'Invalid RDAP query';
        resultobj.process(jobinfo, true);
        return true;
    }
    if (!jobinfo.results.diag) jobinfo.results.diag = {"rdap":{urlchain:[]}};

    var rdapurl = jobinfo.redirecttarget || jobinfo.parameters.rdapurl || 'https://rdap.org/';

    if (net.isIPv4(jobinfo.parameters.target) || net.isIPv6(jobinfo.parameters.target)) {
        // Target is an IP, we'll have to use the default lookup
        targetIsIp = true;
        targetIsAsn = false;
        if (!rdapurl) { rdapurl = 'https://rdap.org/'; }
    } else if (nputil.isNumeric(jobinfo.parameters.target)) {
        // Target is a ASN, we'll have to use the default lookup
        targetIsAsn = true;
        targetIsIp = false;
        if (!rdapurl) { rdapurl = 'https://rdap.org/'; }
    }

    debugMessage('info',"check_rdap: rdapurl: "+sys.inspect(rdapurl));

    var tryIpv6 =  function(hostname) {
        jobinfo.dnsresolutionstart = new Date().getTime();
        dns.resolve6(hostname, function (err, addresses) {
            jobinfo.dnsresolutionend = new Date().getTime();
            if (err) {
                jobinfo.results.success = false;
                jobinfo.results.end = new Date().getTime();jobinfo.results.end = new Date().getTime();
                jobinfo.results.runtime = jobinfo.results.end - jobinfo.results.start;
                jobinfo.results.statusCode = 'Error';
                jobinfo.results.message = 'Error resolving RDAP URL server '+hostname;
                if (err.code === 'ENODATA') {
                    jobinfo.results.message = 'No addresses found for RDAP URL server '+hostname;
                } else if (err.code === 'ENOTFOUND') {
                    jobinfo.results.message = 'No DNS resolution for RDAP URL server '+hostname;
                }
                resultobj.process(jobinfo);
            } else if(addresses && addresses[0]) {
                jobinfo.targetip = addresses[0];
                jobinfo.targethost = hostname;
                retry++;
                return check(jobinfo, retry);
            } else { // no resolution - empty array returned.
                jobinfo.results.success = false;
                jobinfo.results.end = new Date().getTime();
                jobinfo.results.runtime = jobinfo.results.end - jobinfo.results.start;
                jobinfo.results.statusCode = 'Error';
                jobinfo.results.message = 'No DNS addresses found for RDAP server '+hostname;
                resultobj.process(jobinfo);
            }
            return true;
        });
        return true;
    };

    debugMessage('info',"check_rdap: RDAP server - targetip: "+sys.inspect(jobinfo.targetip));
    debugMessage('info',"check_rdap: RDAP server - redirecttarget: "+sys.inspect(jobinfo.redirecttarget));

    if (!jobinfo.redirecttarget || (rdapurl && rdapurl.indexOf(jobinfo.parameters.target) < 15)) {
        // Check for trailing /
        if (rdapurl && rdapurl.substr(-1,1) !== '/') {
            rdapurl = rdapurl+'/';
        }
        //Build the URL based on the type
        if (targetIsIp) {
            if (rdapurl.indexOf('/ip/') < 0) {
                rdapurl = rdapurl+'ip/'+jobinfo.parameters.target;
            }
        } else if (targetIsAsn) {
            if (rdapurl.indexOf('/autnum/') < 0) {
                rdapurl = rdapurl+'autnum/'+jobinfo.parameters.target;
            }
        } else {
            if (rdapurl.indexOf('/domain/') < 0) {
                rdapurl = rdapurl+'domain/'+jobinfo.parameters.target;
            }
        }
    }

    debugMessage('info',"check_rdap: rdapurl2: "+sys.inspect(rdapurl));

    try {
        var targetinfo = require('url').parse(rdapurl);
    } catch(error) {
        debugMessage('info',"check_rdap: Invalid RDAP URL");
        jobinfo.results.end = new Date().getTime();
        jobinfo.results.runtime = jobinfo.results.end - jobinfo.results.start;
        jobinfo.results.success = false;
        jobinfo.results.statusCode = 'error';
        jobinfo.results.message = 'RDAP URL will not parse: '+error;
        resultobj.process(jobinfo, true);
        return true;
    }
    if (targetinfo.protocol) {
        if (targetinfo.protocol == 'http:') {
            var agent = require('http');
        } else if (targetinfo.protocol == 'https:') {
            var agent = require('https');
        } else {
            debugMessage('info',"check_rdap: Invalid protocol: "+targetinfo.protocol);
            jobinfo.results.end = new Date().getTime();
            jobinfo.results.runtime = jobinfo.results.end - jobinfo.results.start;
            jobinfo.results.success = false;
            jobinfo.results.statusCode = 'error';
            jobinfo.results.message = 'Invalid protocol';
            resultobj.process(jobinfo, true);
            return true;
        }
    } else {
        jobinfo.results.end = new Date().getTime();
        jobinfo.results.runtime = jobinfo.results.end - jobinfo.results.start;
        jobinfo.results.success = false;
        jobinfo.results.statusCode = 'error';
        jobinfo.results.message = 'Invalid URL';
        resultobj.process(jobinfo, true);
        return true;
    }
    
    if (!jobinfo.targetip) {
        if (jobinfo.parameters.ipv6) {
            if (!net.isIPv6(targetinfo.hostname)) {
                return tryIpv6(targetinfo.hostname);
            }
        } else {
            // Resolve the ipv4
            if (!net.isIPv4(targetinfo.hostname) && !net.isIPv6(targetinfo.hostname)) {
                jobinfo.dnsresolutionstart = new Date().getTime();
                dns.resolve4(targetinfo.hostname, function (err, addresses) {
                    jobinfo.dnsresolutionend = new Date().getTime();
                    if (err) {
                        //logger.log('info','check_rdap: resolution error: '+sys.inspect(err));
                        //logger.log('info','check_rdap: resolution addresses: '+sys.inspect(addresses));
                        if (err.code === 'ENODATA' || err.code === 'ENOTFOUND') {
                            return tryIpv6(targetinfo.hostname);
                        }
                        jobinfo.results.success = false;
                        jobinfo.results.end = new Date().getTime();
                        jobinfo.results.runtime = jobinfo.results.end - jobinfo.results.start;
                        jobinfo.results.statusCode = 'Error';
                        jobinfo.results.message = 'Error resolving the RDAP URL hostname: '+targetinfo.hostname;
                        resultobj.process(jobinfo);
                    } else if(addresses && addresses.length && addresses[0]) {
                        //logger.log('info','check_rdap: resolution addresses: '+sys.inspect(addresses));
                        if (addresses[0]) {
                            jobinfo.targetip = addresses[0];
                            return check(jobinfo, true);
                        }
                    } else { // no ipv4 resolution - empty array returned.
                        return tryIpv6(targetinfo.hostname);
                    }
                    return true;
                });
                return true;
            } else {
                jobinfo.targetip = targetinfo.hostname;
            }
        }
    } else {
        targetinfo.hostname = jobinfo.targetip;
    }
    var httpheaders = {'Accept': '*/*',
                       'User-Agent': 'NodePing',
                       'Host': targetinfo.host};
    // Auth
    if (targetinfo.auth) {
        httpheaders.Authorization = 'Basic ' + Buffer.from(targetinfo.auth,'utf8').toString('base64');
    }
    var targetoptions = {host:targetinfo.hostname,
                         method:'GET',
                         headers: httpheaders,
                         rejectUnauthorized: false}
    if (targetinfo.port) {
        targetoptions.port = targetinfo.port;
        targetoptions.headers['Host'] = targetoptions.headers['Host']+':'+targetinfo.port;
    }
    if (targetinfo.pathname) {
        if (targetinfo.search) {
            targetoptions.path = targetinfo.pathname+targetinfo.search;
        } else {
            targetoptions.path = targetinfo.pathname;
        }
    }
    targetoptions.timeout = timeout;
    var killit = false;
    debugMessage('info',"check_rdap: HTTP headers: "+sys.inspect(targetoptions.headers));
    // Set diag info on this URL hit
    var diaginfo = {url:rdapurl, sent:targetoptions};
    if (jobinfo.dnsresolutionstart && jobinfo.dnsresolutionend) {
        diaginfo.dnsruntime = jobinfo.dnsresolutionend - jobinfo.dnsresolutionstart;
        diaginfo.dnsresolution = jobinfo.targetip;
    }
    jobinfo.results.diag.rdap.urlchain.push(diaginfo);
    try {
        var timeoutid = setTimeout(function() {
            if (killit) {
                return true;
            }
            killit = true;
            req.abort();
            debugMessage('info',"check_rdap: setTimeout called: "+timeout.toString());
            jobinfo.results.end = new Date().getTime();
            jobinfo.results.runtime = jobinfo.results.end - jobinfo.results.start;
            jobinfo.results.statusCode = 'Timeout';
            jobinfo.results.success = false;
            jobinfo.results.message = 'Timeout';
            resultobj.process(jobinfo);
            return true;
        }, timeout);
        var req = agent.get(targetoptions, function(res) {
            var body = '';
            //debugMessage('info','check_rdap: res inside is: '+sys.inspect(res));
            res.setEncoding('utf8');
            res.on('data', function(d) {
                //debugMessage('info',"check_rdap: Data inside is "+sys.inspect(d));
                body += d;
                if (body.length > 3145728) {// 3MB limit
                    clearTimeout(timeoutid);
                    killit = true;
                    jobinfo.results.end = new Date().getTime();
                    jobinfo.results.runtime = jobinfo.results.end - jobinfo.results.start;
                    jobinfo.results.statusCode = 413;
                    jobinfo.results.success = false;
                    jobinfo.results.message = '3MB response size exceeded';
                    resultobj.process(jobinfo);
                    req.abort();
                    return true;
                }
            });
            res.on('end', function() {
                if (!killit) {
                    clearTimeout(timeoutid);
                    killit = true;
                    delete jobinfo.targetip;
                    debugMessage('info','check_rdap: Response has ended and total body is: '+sys.inspect(body));
                    debugMessage('info','check_rdap: HTTP statuscode: '+sys.inspect(res.statusCode));
                    jobinfo.results.end = new Date().getTime();
                    jobinfo.results.runtime = jobinfo.results.end - jobinfo.results.start;
                    jobinfo.results.statusCode = res.statusCode;
                    jobinfo.results.diag.rdap.urlchain.push({received:{
                        headers: res.headers,
                        httpstatus: res.statusCode,
                        httpserverip: req.connection.remoteAddress,
                        data: body.substring(0,250000)
                    }});
                    jobinfo.results.fieldtracking = {};
                    if (res.statusCode >=200 && res.statusCode < 399) {
                        // Did it take too long?
                        if (defaulttimeout < jobinfo.results.runtime) {
                            debugMessage('info','check_rdap: Timeout: '+sys.inspect(defaulttimeout)+" is less than "+sys.inspect(jobinfo.results.runtime));
                            jobinfo.results.success = false;
                            jobinfo.results.message = 'Timeout';
                            jobinfo.results.statusCode = 'Timeout';
                            resultobj.process(jobinfo);
                            return true;
                        }
                        if (res.statusCode > 299) {  // Redirects
                            // Have we redirected too many times already?
                            if (jobinfo.redirectcount && jobinfo.redirectcount > 4) {
                                // Too many redirects.
                                jobinfo.results.success = false;
                                jobinfo.results.message = 'Too many redirects';
                                resultobj.process(jobinfo);
                                return false;
                            } else {
                                delete jobinfo.targetip;
                                if (!jobinfo.redirectcount) {
                                    jobinfo.redirectcount = 1;
                                } else {
                                    jobinfo.redirectcount = jobinfo.redirectcount + 1;
                                }
                                if (!req.res.headers.location) {
                                    // Redirect without 'location' header.  Sucuri/Cloudproxy
                                    jobinfo.results.success = false;
                                    jobinfo.results.message = 'Redirect without location header';
                                    jobinfo.results.statusCode = req.res.statusCode;
                                    return resultobj.process(jobinfo);
                                }
                                // Set the new redirecttarget and try again.
                                debugMessage('info',"check_rdap: redirect header says "+sys.inspect(req.res.headers.location));
                                var redirect = req.res.headers.location;
                                if (redirect.indexOf('https:') === 0 || redirect.indexOf('http:') === 0 || redirect.indexOf('HTTP:') === 0 || redirect.indexOf('HTTPS:') === 0) {
                                    // Absolute redirect.
                                } else {
                                    // relative redirect - need to get the right base url (either parameters.target or a previous redirect target)
                                    thetarget = rdapurl;
                                    targetinfo = url.parse(thetarget);
                                    if (redirect.indexOf('/') === 0) {
                                        // Replace the whole pathname
                                        var toreplace = targetinfo.pathname;
                                        if (targetinfo.search){
                                            toreplace = toreplace + targetinfo.search;
                                        }
                                        debugMessage('info',"check_rdap: Going to replace: "+sys.inspect(toreplace)+" with "+sys.inspect(redirect));
                                        var pos = targetinfo.href.lastIndexOf(toreplace);
                                        if (pos > 7) {
                                            redirect = targetinfo.href.substring(0, pos) + redirect;
                                        } else {
                                            logger.log('error',"check_rdap: Weird placement for the last instance of: "+sys.inspect(toreplace)+" in "+sys.inspect(redirect)+' for check '+jobinfo.jobid);
                                        }
                                    } else {
                                        // tack this redirect on the end of the current path - removing the search, if any.
                                        if (targetinfo.pathname.slice(-1) !== '/') {
                                            // strip off the last filename if any.
                                            var pos = targetinfo.href.lastIndexOf('/');
                                            if (pos > 7) {
                                                targetinfo.href = targetinfo.href.substring(0, pos);
                                            }
                                            redirect = '/'+redirect;
                                        }
                                        if (targetinfo.search) {
                                            targetinfo.href = targetinfo.href.replace(targetinfo.search,'');
                                        }
                                        redirect = targetinfo.href+redirect;
                                    }
                                }
                                jobinfo.redirecttarget = redirect;
                                jobinfo.redirectstart = jobinfo.results.start; 
                                req.abort();
                                retry++;
                                return check(jobinfo, retry);
                            }
                        }
                        jobinfo.results.success = true;
                        jobinfo.results.message = 'Received data';
                        if (jobinfo.parameters.contentstring) {
                            if (body.indexOf(jobinfo.parameters.contentstring) > -1) {
                                jobinfo.results.message = 'Content found';
                                if (jobinfo.parameters.invert) {
                                    jobinfo.results.success = false;
                                    resultobj.process(jobinfo);
                                    return true;
                                }
                            } else {
                                jobinfo.results.message = 'Content not found';
                                if (!jobinfo.parameters.invert) {
                                    jobinfo.results.success = false;
                                    resultobj.process(jobinfo);
                                    return true;
                                }
                            }
                        }
                        if (jobinfo.parameters.warningdays && !targetIsIp && !targetIsAsn) {
                            var httpparseerrors = [];
                            var jsondata = {};
                            try {
                                // Convert the content to json.
                                jsondata = JSON.parse(body);
                            } catch(jsonerror) {
                                debugMessage('error','check_rdap: JSON parse error: '+sys.inspect(jsonerror));
                                debugMessage('error','check_rdap: Invalid JSON body: '+sys.inspect(body));
                                jobinfo.results.success = false;
                                jobinfo.results.message = 'Invalid JSON response';
                                resultobj.process(jobinfo);
                                return true;
                            }
                            debugMessage('info','check_rdap: JSON received: '+sys.inspect(jsondata));
                            if (jsondata && jsondata.events && jsondata.events.length) {
                                // Check the expiration
                                var foundExpiration = false;
                                for (var i in jsondata.events) {
                                    if (jsondata.events[i] && jsondata.events[i].eventAction && jsondata.events[i].eventAction === 'expiration') {
                                        foundExpiration = true;
                                        var warningdays = parseInt(jobinfo.parameters.warningdays)*86400000; // seconds of warning.
                                        var willexpire = new Date(jsondata.events[i].eventDate).getTime();
                                        if (willexpire < jobinfo.results.end+warningdays) {
                                            jobinfo.results.success = false;
                                            jobinfo.results.message = 'Will expire '+jsondata.events[i].eventDate;
                                            jobinfo.results.statusCode = 'expires '+jsondata.events[i].eventDate;
                                            resultobj.process(jobinfo);
                                            return true;
                                        }
                                    }
                                }
                                if (!foundExpiration) {
                                    jobinfo.results.success = false;
                                    jobinfo.results.message = 'No expiration found: Please contact support.';
                                    jobinfo.results.statusCode = 'error';
                                    resultobj.process(jobinfo);
                                    return true;
                                }
                            }
                        }
                        // SKP - list of fields we support or let them choose anything?
                        resultobj.process(jobinfo);
                        return true;
                    } else {
                        // Status code out of range.
                        jobinfo.results.success = false;
                        jobinfo.results.message = 'HTTP status code: '+res.statusCode;
                        jobinfo.results.statusCode = res.statusCode;
                        jobinfo.results.runtime = 0;
                        resultobj.process(jobinfo);
                        return true;
                    }
                }
                return true;
            });
            return true;
        });
        req.on("error", function(e) {
            clearTimeout(timeoutid);
            if (!killit) {
                killit = true;
                jobinfo.results.end = new Date().getTime();
                jobinfo.results.runtime = jobinfo.results.end - jobinfo.results.start;
                jobinfo.results.statusCode = 'Error';
                jobinfo.results.success = false;
                jobinfo.results.message = e.toString();
                jobinfo.results.diag.error = e.toString();
                resultobj.process(jobinfo);
            }
            return true;
        }).on("timeout", function(to) {
            clearTimeout(timeoutid);
            if (!killit) {
                killit = true;
                debugMessage('info',"check_rdap: Caught timeout");
                jobinfo.results.end = new Date().getTime();
                jobinfo.results.runtime = jobinfo.results.end - jobinfo.results.start;
                jobinfo.results.statusCode = 'Timeout';
                jobinfo.results.success = false;
                jobinfo.results.message = 'Timeout';
                resultobj.process(jobinfo);
            }
            req.abort();
            return true;
        });
        req.on("socket", function (socket) {
            socket.emit("agentRemove");
        });
    } catch(ec) {
        clearTimeout(timeoutid);
        if (!killit) {
            if (req) req.destroy();
            jobinfo.results.end = new Date().getTime();
            jobinfo.results.runtime = jobinfo.results.end - jobinfo.results.start;
            jobinfo.results.statusCode = 'Error';
            jobinfo.results.success = false;
            jobinfo.results.message = "Caught "+ec.toString();
            jobinfo.results.diag.error = "Caught "+ec.toString();
            resultobj.process(jobinfo);
            killit = true;
        }
        return true;
    }
    function debugMessage(messageType, message) {
        if (jobinfo.debug || config.debug) {
            logger.log(messageType,message);
        }
    }
    return true;
};