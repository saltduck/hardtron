const { ethers } = require("hardhat");

let ACCOUNTS;
let CONTRACTS;

module.exports = {
    init(config) {
        ACCOUNTS = config.ACCOUNTS
        CONTRACTS = config.CONTRACTS
    },
    async getAccount(chainId) {
        if (chainId == 31337) {
            return await getNamedAccounts()
        }
        return ACCOUNTS[chainId]
    },
    async getContract(chainId, name, artifact = "") {
        let contract = await ethers.getContractOrNull(name)
        if (contract) {
            return contract
        }
        if (!artifact) artifact = name
        return await ethers.getContractAt(artifact, CONTRACTS[chainId][name])
    },
    async getContractAddress(chainId, name) {
        if (chainId == 31337) {
            return (await ethers.getContract(name)).address
        }
        return CONTRACTS[chainId][name]
    }
}
