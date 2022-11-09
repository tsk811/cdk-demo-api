#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { ApplicationStack } from '../lib/Application-stack';
import { PipelineStack } from '../lib/pipeline-stack'
import { CommonConfigs, ApplicationConfig } from '../lib/model/configuration';

const commonConfigs: CommonConfigs = require('../lib/configurations/commonConfigs.json')

const applicationConfigNonProd: ApplicationConfig = require('../lib/configurations/applicationConfigNonProd.json')
const applicationConfigProd: ApplicationConfig = require('../lib/configurations/applicationConfigProd.json')


const app = new cdk.App();
const appName = commonConfigs.appName

const nonProdAppStack = new ApplicationStack(app, `${appName}NonProdApplicationStack`, {
    commonConfigs: commonConfigs,
    appConfigs: applicationConfigNonProd,
    stackName: `${appName}NonProdApplicationStack`,
    env: {
        region: commonConfigs.account.region,
        account: commonConfigs.account.nonProd,
    }
});

const prodAppStack = new ApplicationStack(app, `${appName}ProdApplicationStack`, {
    commonConfigs: commonConfigs,
    appConfigs: applicationConfigProd,
    stackName: `${appName}ProdApplicationStack`,
    env: {
        region: commonConfigs.account.region,
        account: commonConfigs.account.prod,
    }
});

const pipelineStack = new PipelineStack(app, `${appName}PipelineStack`, {
    commonConfigs: commonConfigs,
    nonProdApplicationStack: nonProdAppStack,
    nonProdConfigs: applicationConfigNonProd,
    prodApplicationStack: prodAppStack,
    prodConfigs: applicationConfigProd,
    stackName: `${appName}PipelineStack`,
    env: {
        region: commonConfigs.account.region,
        account: commonConfigs.account.nonProd,
    }
})
