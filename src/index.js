const { ArgumentParser } = require('argparse');
const TronWeb = require('tronweb');
const hre = require("hardhat");

let tronWeb;
let gNetwork = {};

module.exports = {
  async setNetwork(name) {
    gNetwork.name = name
    if (['tron', 'shasta'].indexOf(name) > -1) {
      gNetwork.type = 'TRON'
      if (name == 'tron') {
        const api = 'https://api.trongrid.io'
        const privateKey = process.env.PRIVATE_KEY_TRON_MAIN
        gNetwork.web3 = await this.init(api, privateKey)
      } else if (name == 'shasta') {
        const api = 'https://api.shasta.trongrid.io'
        const privateKey = process.env.PRIVATE_KEY_TRON_SHASTA
        gNetwork.web3 = await this.init(api, privateKey)
      }
    } else {
      gNetwork.type = 'ETH'
      await hre.changeNetwork(name)
    }
  },
  getNetworkType() {
    return gNetwork.type
  },
  getNetworkName() {
    return gNetwork.name
  },
  formatAddress(addr) {
    return gNetwork.type == 'TRON'?
      gNetwork.web3.address.fromHex(addr):
      addr
  },
  async getOwner() {
    if (gNetwork.type == 'TRON') {
      return tronWeb.defaultAddress.base58;
    }
    const [owner] = await hre.ethers.getSigners();
    return owner.address;
  },
  async init(api, privateKey) {
    tronWeb = new TronWeb({
      fullHost: api,
      headers: {"TRON-PRO-API-KEY": process.env.TRON_API_KEY},
      privateKey: privateKey
    })
    return tronWeb;
  },

  async deploy(factoryName, contractName, parameters, opt = {}) {
    let issuerAddress = await this.getOwner();
    // console.log(issuerAddress)

    let contract;
    if(opt.hasOwnProperty("libraries")) {
      contract = await hre.ethers.getContractFactory(factoryName, {libraries:opt.libraries});
    } else {
      contract = await hre.ethers.getContractFactory(factoryName);
    }

    if (gNetwork.type == 'TRON') {
      issuerAddress = tronWeb.address.toHex(issuerAddress);
      const bytecode = contract.bytecode;
      const {abi} = await hre.artifacts.readArtifact(factoryName)
      let options = {
        feeLimit: 1_000_000_000,
        abi: JSON.stringify(abi), //Abi string
        bytecode: bytecode,       //Bytecode, default hexString
        name: contractName,       //Contract name string
        owner_address: issuerAddress,
      };
      options.parameters = parameters;
      let data = await tronWeb.transactionBuilder.createSmartContract(options, issuerAddress);

      const signedTxn = await tronWeb.trx.sign(data);
      const receipt = await tronWeb.trx.sendRawTransaction(signedTxn);
      console.log(contractName + " deployed at: " + tronWeb.address.fromHex(receipt.transaction.contract_address));
      await this.sleep(5);
      let contractAddress = receipt.transaction.contract_address;
      return await tronWeb.contract(abi, contractAddress);  
    } else {
      const c = await contract.deploy(...parameters)
      await c.deployed()
      console.log(contractName + " deployed at: " + c.address);
      return c
    }
  },

  async getContractAt(name, addr) {
    if (gNetwork.type == 'ETH') {
      return await hre.ethers.getContractAt(name, addr)
    } else if (gNetwork.type == 'TRON') {
      let {abi} = await hre.artifacts.readArtifact(name)
      contract = await tronWeb.contract(abi, addr);
      return new Proxy(contract, {
        get: (target, prop, receiver) => {
          // console.debug('prop: ', prop)
          if (['then', 'abi', 'address', 'methodInstances'].indexOf(prop) > -1) {
            return Reflect.get(target, prop)
          }
          return new Proxy(target[prop], {
            apply: function(target2, ctx, args) {
              // console.log(ctx.keys)
              const mutability = ctx.methodInstances[prop].abi.stateMutability
              if (mutability == 'view' || mutability == 'pure') {
                return Reflect.apply(...arguments).call()
              } else {
                return Reflect.apply(...arguments).send({
                  feeLimit: 500_000_000,
                  callValue: 0,
                  shouldPollResponse: false
                })
              }
            },
          })
        }
      })
    }
  },
  async sleep(time) {
    await new Promise((resolve, reject) => {
      setTimeout(() => {
        resolve()
      }, time * 1000)
    })
  },
  addressToHex(address) {
    if (address.substr(0, 2) == '0x')
      return address
    return "0x" + tronWeb.address.toHex(address).substr(2, 42);
  },
  addressToHex2(address) {
    if (address.substr(0, 2) == '0x')
      return address
    return tronWeb.address.toHex(address);
  },
  async parseArgs() {
    const parser = new ArgumentParser({})
    parser.add_argument('-n', '--network', {help: 'network name(BSC/ROPSTEN/TRON/SHASTA/...)'})
    parser.add_argument('-f', '--function', {help: 'function name you want to call?'})
    args = parser.parse_args()
    await this.setNetwork(args.network)
    return args.function
  }
}