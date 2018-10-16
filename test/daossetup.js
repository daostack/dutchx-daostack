import * as helpers from './helpers';
const constants = require('./constants');
const GenericScheme = artifacts.require('./GenericScheme.sol');
const DaoCreator = artifacts.require("./DaoCreator.sol");
const ControllerCreator = artifacts.require("./ControllerCreator.sol");
const Forwarder = artifacts.require("./Forwarder.sol");
const ControllerInterface = artifacts.require("./ControllerInterface.sol");
const DutchXMock = artifacts.require("./DutchXMock.sol");


export class GenericSchemeParams {
  constructor() {
  }
}

const setupGenericSchemeParams = async function(
                                            genericScheme,
                                            accounts,
                                            contractToCall,
                                            tokenAddress = 0
                                            ) {
  var genericSchemeParams = new GenericSchemeParams();

  genericSchemeParams.votingMachine = await helpers.setupGenesisProtocol(accounts,tokenAddress,0,0);
  await genericScheme.setParameters(genericSchemeParams.votingMachine.params,genericSchemeParams.votingMachine.genesisProtocol.address,contractToCall);
  genericSchemeParams.paramsHash = await genericScheme.getParametersHash(genericSchemeParams.votingMachine.params,genericSchemeParams.votingMachine.genesisProtocol.address,contractToCall);

  return genericSchemeParams;
};

const setupDutchXDAO = async function (accounts) {
   var testSetup = new helpers.TestSetup();
   var controllerCreator = await ControllerCreator.new({gas: constants.ARC_GAS_LIMIT});
   testSetup.daoCreator = await DaoCreator.new(controllerCreator.address,{gas:constants.ARC_GAS_LIMIT});
   testSetup.reputationArray = [20,10,70];
   //setup a dao with no reputation.
   testSetup.org = await helpers.setupOrganizationWithArrays(testSetup.daoCreator,[accounts[0]],[0],[0]);

   testSetup.forwarder = await Forwarder.new();
   testSetup.expirationTime = (await web3.eth.getBlock("latest")).timestamp + 3000;
   await testSetup.forwarder.initialize(testSetup.org.avatar.address,
                                        testSetup.expirationTime);

    //set a dao with only forwarder schemes with full permissions
   await testSetup.daoCreator.setSchemes(testSetup.org.avatar.address,
                                        [testSetup.forwarder.address,],
                                        [helpers.NULL_HASH],["0x0000001f"]);


   return testSetup;
};


const setupGenesisAlphaDAO = async function (accounts,contractToCall) {
   var testSetup = new helpers.TestSetup();
   testSetup.genericScheme = await GenericScheme.new();
   var controllerCreator = await ControllerCreator.new({gas: constants.ARC_GAS_LIMIT});
   testSetup.daoCreator = await DaoCreator.new(controllerCreator.address,{gas:constants.ARC_GAS_LIMIT});
   testSetup.reputationArray = [20,10,70];
   //setup a dao with reputations.
   testSetup.org = await helpers.setupOrganizationWithArrays(testSetup.daoCreator,[accounts[0],accounts[1],accounts[2]],[0,0,0],testSetup.reputationArray);

   //set up a generic scheme with genesisProtocol
   testSetup.genericSchemeParams= await setupGenericSchemeParams(testSetup.genericScheme,accounts,contractToCall,0);

   var permissions = "0x00000010";

    //set a dao with only genericScheme with full permissions
   await testSetup.daoCreator.setSchemes(testSetup.org.avatar.address,
                                        [testSetup.genericScheme.address],
                                        [testSetup.genericSchemeParams.paramsHash],[permissions]);


   return testSetup;
};


contract('dutchx-genesisalpha', function(accounts) {
  before(function() {
    helpers.etherForEveryone(accounts);
  });
  it("full scenario", async function() {
     var dutchXDAO  = await setupDutchXDAO(accounts);
     //setup genesis alpha dao with generic scheme which can call the dutchXDAO forwarder contract.
     var genesisAlphaDAO  = await setupGenesisAlphaDAO(accounts,dutchXDAO.forwarder.address);
     //transferOwnership of forwarder to genesis alpha avatar
     await dutchXDAO.forwarder.transferOwnership(genesisAlphaDAO.org.avatar.address);
     //get the dutchXDAO Controller
     var dutchXDAOController = await ControllerInterface.at(await dutchXDAO.org.avatar.owner());
     //prepare a call to register genericScheme as a new scheme on the dutchX dao.
     //setup new param for genericScheme to call dutchXMock
     var dutchXMock =  await DutchXMock.new();
     await genesisAlphaDAO.genericScheme.setParameters(genesisAlphaDAO.genericSchemeParams.votingMachine.params,
                                                       genesisAlphaDAO.genericSchemeParams.votingMachine.genesisProtocol.address,
                                                       dutchXMock.address);


     var gs_paramsHash = await genesisAlphaDAO.genericScheme.getParametersHash(genesisAlphaDAO.genericSchemeParams.votingMachine.params,
                                                                               genesisAlphaDAO.genericSchemeParams.votingMachine.genesisProtocol.address,
                                                                               dutchXMock.address);
     var callData   = await new web3.eth.Contract(dutchXDAOController.abi).
                                methods.
                                registerScheme(genesisAlphaDAO.genericScheme.address,gs_paramsHash,"0x00000010",dutchXDAO.org.avatar.address).
                                encodeABI();

     var tx = await genesisAlphaDAO.genericScheme.proposeCall(genesisAlphaDAO.org.avatar.address,
                                                              callData);

     var proposalId = await helpers.getValueFromLogs(tx, '_proposalId');
     await genesisAlphaDAO.genericSchemeParams.votingMachine.genesisProtocol.vote(proposalId,1,0,{from:accounts[2]});
     assert.equal(await dutchXDAOController.isSchemeRegistered(genesisAlphaDAO.genericScheme.address,dutchXDAO.org.avatar.address),true);

     // mint reputation for accounts[1] in dutchXDAO
    callData   = await new web3.eth.Contract(dutchXDAOController.abi).
                               methods.
                               mintReputation(1,accounts[1],dutchXDAO.org.avatar.address).
                               encodeABI();

    //propose on genesisAlphaDAO
    tx = await genesisAlphaDAO.genericScheme.proposeCall(genesisAlphaDAO.org.avatar.address,callData);
    proposalId = await helpers.getValueFromLogs(tx, '_proposalId');
     //vote and execute on genesisAlphaDAO
    await genesisAlphaDAO.genericSchemeParams.votingMachine.genesisProtocol.vote(proposalId,1,0,{from:accounts[2]});


     //do a generic call on dutchX

     callData   = await new web3.eth.Contract(dutchXMock.abi).
                                methods.
                                test(dutchXDAO.org.avatar.address).
                                encodeABI();
    // propose on dutchXDAO to call dutchXMock
    tx = await genesisAlphaDAO.genericScheme.proposeCall(dutchXDAO.org.avatar.address,callData);
    proposalId = await helpers.getValueFromLogs(tx, '_proposalId');
     //account[1] vote and execute on genesisAlphaDAO
    await genesisAlphaDAO.genericSchemeParams.votingMachine.genesisProtocol.vote(proposalId,1,0,{from:accounts[1]});
    assert.equal(await dutchXMock.lastCaller(),dutchXDAO.org.avatar.address);

  });
});
