import * as codeBuild from 'aws-cdk-lib/aws-codebuild'
import * as iam from 'aws-cdk-lib/aws-iam'
import { IVpc } from 'aws-cdk-lib/aws-ec2'
import { CommonConfigs } from '../model/configuration'

function createBuildSpecEnv(env: any, exportedVariable: string = "") {
    if (exportedVariable) {
        return { variables: env }
    }
    else {
        return {
            variables: env,
            'exported-variables': ["SHA"]
        }
    }
}

export function buildProject(stack: any,
    name: string,
    phases: any,
    vpc: IVpc,
    env: any,
    artifacts: any,
    isPrivileged: boolean) {
    return new codeBuild.PipelineProject(stack, name, {

        buildSpec: codeBuild.BuildSpec.fromObject({
            version: '0.2',
            env: createBuildSpecEnv(env),
            phases: phases,
            artifacts: artifacts,

        }),
        vpc: vpc,
        environment: {
            buildImage: codeBuild.LinuxBuildImage.AMAZON_LINUX_2_4,
            privileged: isPrivileged
        },

    })
}

//Not in use
export function buildServiceUpdatePolicy(service: string) {
    return new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ["ecs:Describe*", "ecs:List*", "ecs:UpdateService*", "ecs:*Task*"],
        resources: [`arn:aws:ecs:*:*:service/*/${service}`],
    })

}

//Not in use
export function buildServiceUpdateProject(env: string, serviceName: string, vpc: IVpc, stack: any) {
    return buildProject(stack, `${env}ECSServiceDeploy`,
        {
            build: { commands: ["make ecs.deploy", "make ecs.poll.status"] }
        },
        vpc,
        {
            CLUSTER: `${env}Cluster`,
            SERVICE: serviceName
        },
        {},
        false
    )

}

export function cdkBuildProject(stack: any, name: string, artifact: any, vpc: IVpc) {
    return buildProject(stack, name,
        {
            build: { commands: ['make install'] }
        },
        vpc,
        {
            // No environment variables
        },
        {
            'base-directory': 'cdk.out',
            "files": ['*.template.json'],
            "name": artifact
        },
        false)
}

export function lambdaBuildProject(stack: any, name: string, artifact: any, vpc: IVpc) {
    return buildProject(stack, name,
        {
            build: { commands: ['make pip.install'] }
        },
        vpc,
        {
            // No environment variables
        },
        {
            'base-directory': 'lambda',
            "files": ['**/*'],
            "name": artifact
        },
        false)
}

export function dockerBuildProject(stack: any, name: string, artifact: any, vpc: IVpc, commonConfigs: CommonConfigs, uri: string) {
    return buildProject(stack, name,
        {
            build: {
                commands: ["SHA=$(echo $CODEBUILD_RESOLVED_SOURCE_VERSION | cut -b -6)",
                    "make docker.push", "make docker.createDef"]
            }
        },
        vpc,
        {
            AWS_DEFAULT_REGION: commonConfigs.account.region,
            AWS_ACCOUNT_ID: commonConfigs.account.nonProd,
            ECR_URL_NON_PROD: uri,
            TAG: commonConfigs.fargateService.imageTag,
            CONTAINER_NAME: commonConfigs.fargateService.container
        },
        {
            //This is a json file artifact which contains image details. Not used currently.
            "files": ['imagedefinitions.json'],
            "name": artifact
        },
        true// needed for docker build
    )
}

export function dockerPushProject(stack: any, name: string, vpc: IVpc, commonConfigs: CommonConfigs, uriNonProd: string, uriProd: string) {
    return buildProject(stack, name,
        {
            build: {
                commands: [
                    "make docker.push.prod"]
            }
        },
        vpc,
        {
            AWS_DEFAULT_REGION: commonConfigs.account.region,
            NON_PROD_ACCOUNT: commonConfigs.account.nonProd,
            PROD_ACCOUNT: commonConfigs.account.prod,
            ECR_URL_NON_PROD: uriNonProd,
            ECR_URL_PROD: uriProd,
            TAG: commonConfigs.fargateService.imageTag
        },
        {
            //No artifacts
        },
        true// needed for docker build
    )
}