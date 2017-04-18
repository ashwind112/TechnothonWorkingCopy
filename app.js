process.env.GOPATH = __dirname;

var hfc = require('hfc');
var util = require('util');
var fs = require('fs');
const https = require('https');

// 1 - started
var express = require('express');
var bodyParser = require('body-parser');
var path = require('path');
var http = require('http');
var app = express();

// all environments
app.set('port', process.env.PORT || 3000);
app.set('views', __dirname + '/views');
app.set('view engine', 'ejs');
app.engine('html', require('ejs').renderFile);
app.use(bodyParser.urlencoded({
    extended: true
}));
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, 'public')));

// =====================================================================================================================
//                                              Launch Webserver
// =====================================================================================================================
// Start the web server using our express app to handle requests
var host = process.env.VCAP_APP_HOST || 'localhost';
var port = process.env.VCAP_APP_PORT || 3000;
console.log('Staring http server on: ' + host + ':' + port);
var server = http.createServer(app).listen(port, function () {
    console.log('Server Up - ' + host + ':' + port);
});
// 1- End

//2-Begin
// This router will serve up our pages and API calls.
//var router = require('./routes/site_router');
//app.use('/', router);
//2-End

var config;
var chain;
var network;
var certPath;
var peers;
var users;
var userObj;
var newUserName;
var chaincodeID;
var certFile = 'us.blockchain.ibm.com.cert';
var chaincodeIDPath = __dirname + "/chaincodeID";
//var chaincodeID = "09d93af173f1e6b1ee202a550bc88e6fae877fd42e9e1e557438dbe860f23a8c";


var caUrl;
var peerUrls = [];
var EventUrls = [];

init();

function init() {
    try {
        config = JSON.parse(fs.readFileSync(__dirname + '/config.json', 'utf8'));
    } catch (err) {
        console.log("config.json is missing or invalid file, Rerun the program with right file")
        process.exit();
    }

    // Create a client blockchin.
    chain = hfc.newChain(config.chainName);
    //path to copy the certificate
    certPath = __dirname + "/src/" + config.deployRequest.chaincodePath + "/certificate.pem";

    // Read and process the credentials.json
    try {
        network = JSON.parse(fs.readFileSync(__dirname + '/ServiceCredentials.json', 'utf8'));
        if (network.credentials) network = network.credentials;
    } catch (err) {
        console.log("ServiceCredentials.json is missing or invalid file, Rerun the program with right file")
        process.exit();
    }

    peers = network.peers;
    users = network.users;

    setup();

    printNetworkDetails();
    //Check if chaincode is already deployed
    //TODO: Deploy failures aswell returns chaincodeID, How to address such issue?
    console.log("*** FileExist : ", fileExists(chaincodeIDPath));
    if (chaincodeID) {
        //console.log("\n\nCHAIN : ", chain);

        chain.getUser(newUserName, function(err, user) {
            if (err) throw Error(" Failed to register and enroll " + deployerName + ": " + err);
            userObj = user;
            invoke(function(err1, response) {
            if (err1) {
            console.log("Invoke Err :", err);
            } else {
            console.log(response);
        }});
        });
    }
    else if (fileExists(chaincodeIDPath)) {
        // Read chaincodeID and use this for sub sequent Invokes/Queries
        chaincodeID = fs.readFileSync(chaincodeIDPath, 'utf8');
        //console.log("\n\nCHAIN : ", chain);
        chain.getUser(newUserName, function(err, user) {
            if (err) throw Error(" Failed to register and enroll " + deployerName + ": " + err);
            console.log("*** getUSer: ", user);
            userObj = user;
            //invoke();
            invoke(function(err1, response) {
            if (err1) {
            console.log("Invoke Err :", err);
            } else {
            console.log(response);
            res.json(response);
            }
            });
        });
    } else {
        enrollAndRegisterUsers();
    }
}

function setup() {
    // Determining if we are running on a startup or HSBN network based on the url
    // of the discovery host name.  The HSBN will contain the string zone.
    var isHSBN = peers[0].discovery_host.indexOf('secure') >= 0 ? true : false;
    var network_id = Object.keys(network.ca);
    caUrl = "grpcs://" + network.ca[network_id].discovery_host + ":" + network.ca[network_id].discovery_port;

    // Configure the KeyValStore which is used to store sensitive keys.
    // This data needs to be located or accessible any time the users enrollmentID
    // perform any functions on the blockchain.  The users are not usable without
    // This data.
    var uuid = network_id[0].substring(0, 8);
    chain.setKeyValStore(hfc.newFileKeyValStore(__dirname + '/keyValStore-' + uuid));

    if (isHSBN) {
        certFile = '0.secure.blockchain.ibm.com.cert';
    }
    fs.createReadStream(certFile).pipe(fs.createWriteStream(certPath));
    var cert = fs.readFileSync(certFile);

    chain.setMemberServicesUrl(caUrl, {
        pem: cert, "grpc.initial_reconnect_backoff_ms": 5000
    });

    peerUrls = [];
    eventUrls = [];
    // Adding all the peers to blockchain
    // this adds high availability for the client
    for (var i = 0; i < peers.length; i++) {
        // Peers on Bluemix require secured connections, hence 'grpcs://'
        peerUrls.push("grpcs://" + peers[i].discovery_host + ":" + peers[i].discovery_port);
        chain.addPeer(peerUrls[i], {
            pem: cert, "grpc.initial_reconnect_backoff_ms": 5000
        });
        eventUrls.push("grpcs://" + peers[i].event_host + ":" + peers[i].event_port);
        // chain.eventHubConnect(eventUrls[0], {
        //     pem: cert
        // });
    }
    newUserName = config.user.username;
    // Make sure disconnect the eventhub on exit
    // process.on('exit', function() {
    //     chain.eventHubDisconnect();
    // });
}

function printNetworkDetails() {
    console.log("\n------------- ca-server, peers and event URL:PORT information: -------------");
    console.log("\nCA server Url : %s\n", caUrl);
    for (var i = 0; i < peerUrls.length; i++) {
        console.log("Validating Peer%d : %s", i, peerUrls[i]);
    }
    console.log("");
    for (var i = 0; i < eventUrls.length; i++) {
        console.log("Event Url on Peer%d : %s", i, eventUrls[i]);
    }
    console.log("");
    console.log('-----------------------------------------------------------\n');
}

function enrollAndRegisterUsers() {

    // Enroll a 'admin' who is already registered because it is
    // listed in fabric/membersrvc/membersrvc.yaml with it's one time password.
    chain.enroll(users[0].enrollId, users[0].enrollSecret, function(err, admin) {
        if (err) throw Error("\nERROR: failed to enroll admin : " + err);

        console.log("\nEnrolled admin sucecssfully");

        // Set this user as the chain's registrar which is authorized to register other users.
        chain.setRegistrar(admin);

        //creating a new user
        var registrationRequest = {
            enrollmentID: newUserName,
            affiliation: config.user.affiliation
        };
        chain.registerAndEnroll(registrationRequest, function(err, user) {
            if (err) throw Error(" Failed to register and enroll " + newUserName + ": " + err);

            console.log("\nEnrolled and registered " + newUserName + " successfully");
            userObj = user;
            //console.log("\nUser Object: ", userObj);
            //setting timers for fabric waits
            chain.setDeployWaitTime(config.deployWaitTime);
            console.log("\nDeploying chaincode ...");
            deployChaincode();
        });
    });
}

function deployChaincode() {
    console.log("\nCalling deployChaincode()...");
    var args = getArgs(config.deployRequest);
    // Construct the deploy request
    var deployRequest = {
        // Function to trigger
        fcn: config.deployRequest.functionName,
        // Arguments to the initializing function
        args: args,
        chaincodePath: config.deployRequest.chaincodePath,
        // the location where the startup and HSBN store the certificates
        certificatePath: network.cert_path
    };

    // Trigger the deploy transaction
    var deployTx = userObj.deploy(deployRequest);

    deployTx.on('submitted', function (results) {
        console.log('Successfully submitted chaincode deploy transaction', results.chaincodeID);
        console.log('Will wait for', config.deployWaitTime,
            'seconds after deployment for chaincode to startup');
    });
    // Print the deploy results
    deployTx.on('complete', function(results) {
        // Deploy request completed successfully
        chaincodeID = results.chaincodeID;
        console.log("\nChaincode ID : " + chaincodeID);
        console.log(util.format("\nSuccessfully deployed chaincode: request=%j, response=%j", deployRequest, results));
        // Save the chaincodeID
        fs.writeFileSync(chaincodeIDPath, chaincodeID);
        console.log("*** in DeployChainCode FileExist : ", fileExists(chaincodeIDPath));
        //invoke();
    });

    deployTx.on('error', function(err) {
        // Deploy request failed
        console.log(util.format("\nFailed to deploy chaincode: request=%j, error=%j", deployRequest, err));
        //process.exit(1);
        deployChaincode();
    });
}

function invoke() {
    return new Promise (function(resolve,reject){
    var args = getArgs(config.invokeRequest);
    //var eh = chain.getEventHub();
    // Construct the invoke request
    var invokeRequest = {
        // Name (hash) required for invoke
        chaincodeID: chaincodeID,
        // Function to trigger
        fcn: config.invokeRequest.functionName,
        // Parameters for the invoke function
        args: args
    };

    //console.log("\n INVOKE: User Object: ", userObj);
    // Trigger the invoke transaction
    var invokeTx = userObj.invoke(invokeRequest);

    // Print the invoke results
    invokeTx.on('submitted', function(results) {
        // Invoke transaction submitted successfully
        console.log(util.format("\nSuccessfully submitted chaincode invoke transaction: request=%j, response=%j", invokeRequest, results));
        //return results;
        return resolve({statusCode : "SUBMITTED", body : results});
    });
    invokeTx.on('complete', function(results) {
        // Invoke transaction completed successfully
        console.log(util.format("\nSuccessfully completed chaincode invoke transaction: request=%j, response=%j", invokeRequest, results));
        query();
        return resolve({statusCode : "SUCCESS", body : results});
    });
    invokeTx.on('error', function(err) {
        // Invoke transaction submission failed
        console.log(util.format("\nFailed to submit chaincode invoke transaction: request=%j, error=%j", invokeRequest, err));
        //process.exit(1);
        return reject({statusCode : "TXNFAILED", body : err});
    });

    //Listen to custom events
    // var regid = eh.registerChaincodeEvent(chaincodeID, "evtsender", function(event) {
    //     console.log(util.format("Custom event received, payload: %j\n", event.payload.toString()));
    //     eh.unregisterChaincodeEvent(regid);
    // });
});
}

function query(param) {
    return new Promise (function(resolve,reject){
        var args;
        var queryRequest;
        if (param === 0) {
            args = getArgs(config.queryRequest);
            // Construct the query request
            queryRequest = {
            // Name (hash) required for query
            chaincodeID: chaincodeID,
            // Function to trigger
            fcn: config.queryRequest.functionName,
            // Existing state variable to retrieve
            args: args
            };
        } else {
            args = getArgs(config.queryRequest1);
            queryRequest = {
            chaincodeID: chaincodeID,
            fcn: config.queryRequest1.functionName,
            args: args
            };
        }
    //var args = getArgs(config.queryRequest);
    

    //console.log("\n QUERY: User Object: ", userObj);
    // Trigger the query transaction
    var queryTx = userObj.query(queryRequest);

    // Print the query results
    queryTx.on('complete', function(results) {
        // Query completed successfully
        console.log("\nSuccessfully queried  chaincode function: request=%j, value=%s", queryRequest, results.result.toString());
        //process.exit(0);
        return resolve({statusCode : "SUCCESS", body : results.result.toString()});
    });
    queryTx.on('error', function(err) {
        // Query failed
        console.log("\nFailed to query chaincode, function: request=%j, error=%j", queryRequest, err);
        //process.exit(1);
        return reject({statusCode : "TXNFAILED", body : err});
    });
});
}

function getArgs(request) {
    var args = [];
    for (var i = 0; i < request.args.length; i++) {
        args.push(request.args[i]);
    }
    return args;
}

function fileExists(filePath) {
    try {
        return fs.statSync(filePath).isFile();
    } catch (err) {
        return false;
    }
}




//3 - Started
app.get('/', function (req, res) {
    res.render('index.html');
});

//Invoke function
app.get('/invoke', function (req, res) {
    console.log("in invoke");
    //res.json("Create Function");
    invoke()
    .then (function(response) {
        console.log(response);
        res.json(response);
    })
    .catch(function(err) {
        console.log("Invoke Err :", err);
        res.json(err);
    })
});

//Query function
app.get('/query', function (req, res) {
    console.log("in query");
    //res.json("Read Function");
    var param = 0;
    query(param)
    .then (function(response) {
            console.log(response);
            res.json(response);
    })
    .catch(function(err) {
        console.log("Query Err :", err);
        res.json(err);
    })
});

//Query1 function
app.get('/query1', function (req, res) {
    console.log("in query1");
    //res.json("Read Function");
    var param = 1;
    query(param)
    .then (function(response) {
            console.log(response);
            res.json(response);
    })
    .catch(function(err) {
        console.log("Query Err :", err);
        res.json(err);
    })
});
app.get('/deploy_private',function(req,res){
    console.log("\nCalling deployChaincode()...");
    var ucert=""
    chain.getUser("JohnDoe",function(err,user){
        if(!err){
            var userObj=user;
            ucert=userObj.cert;
        }
    })
    // Construct the deploy request
    var deployRequest = {
        // Function to trigger
        fcn: "init",
        // Arguments to the initializing function
        args:["ashwin","divekar"] ,

        chaincodePath:"chaincode_private_key",
        // the location where the startup and HSBN store the certificates
        certificatePath: network.cert_path,
        metadata:ucert
    };

    // Trigger the deploy transaction
    var deployTx = userObj.deploy(deployRequest);

    deployTx.on('submitted', function (resuxlts) {
        console.log('Successfully submitted chaincode deploy transaction', results.chaincodeID);
        console.log('Will wait for', config.deployWaitTime,
            'seconds after deployment for chaincode to startup');
    });
    // Print the deploy results
    deployTx.on('complete', function(results) {
        // Deploy request completed successfully
        chaincodeID = results.chaincodeID;
        console.log("\nChaincode ID : " + chaincodeID);
        console.log(util.format("\nSuccessfully deployed chaincode: request=%j, response=%j", deployRequest, results));
        // Save the chaincodeID
        fs.writeFileSync(chaincodeIDPath+"2", chaincodeID);
        console.log("*** in DeployChainCode FileExist : ", fileExists(chaincodeIDPath));
        //invoke();

        

    });

    deployTx.on('error', function(err) {
        // Deploy request failed
        console.log(util.format("\nFailed to deploy chaincode: request=%j, error=%j", deployRequest, err));
        //process.exit(1);
        //deployChaincode();
    });
})
// app.get('/create1', function (req, res) {
//     console.log("in create1");
//     chaincode_ops.createCompany(req.session.username, function(err, res1) {
//                 if(err) {
//                     console.error(TAG, 'failed to initialize user account:', err.message);
//                     // TODO set an error and return to the login screen
//                     return res.json(err);
//                 }
//                 console.log(res1);
//                 res.json(res1);
//     });

// });
//2 - End

