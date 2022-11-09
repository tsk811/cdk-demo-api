import * as codepipeline from 'aws-cdk-lib/aws-codepipeline'
import * as codeCommit from 'aws-cdk-lib/aws-codecommit'
import * as codepipeline_actions from 'aws-cdk-lib/aws-codepipeline-actions'
import { App, Stack, StackProps } from 'aws-cdk-lib';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as kms from 'aws-cdk-lib/aws-kms';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import { Construct } from 'constructs';
import { CommonConfigs, ApplicationConfig } from './model/configuration';
import { ApplicationStack } from './Application-stack';

import * as util from './utils/util'

export interface PipelineProps extends StackProps {
  readonly commonConfigs: CommonConfigs
  readonly nonProdApplicationStack: ApplicationStack
  readonly nonProdConfigs: ApplicationConfig
  readonly prodApplicationStack: ApplicationStack
  readonly prodConfigs: ApplicationConfig
  readonly stackName: string

}

export class PipelineStack extends Stack {
  constructor(app: App, id: string, props: PipelineProps) {
    super(app, id, props);

    const commonConfigs = props.commonConfigs
    const nonProdApplicationStack = props.nonProdApplicationStack
    const prodApplicationStack = props.prodApplicationStack
    const stackName = props.stackName;
    function getValueFromParameterStore(name: string, stack: Construct) {
      return (ssm.StringParameter.fromStringParameterAttributes(stack, `${name}Parameter`, {
        parameterName: name
      })).stringValue
    }


    const vpcId = getValueFromParameterStore(commonConfigs.vpcInfo.vpcId, this)

    const availabilityZones = getValueFromParameterStore(commonConfigs.vpcInfo.availabilityZones, this)

    const privateSubnets = getValueFromParameterStore(commonConfigs.vpcInfo.privateSubnets, this).split(",")
    const publicSubnets = getValueFromParameterStore(commonConfigs.vpcInfo.publicSubnets, this).split(",")

    const vpc = ec2.Vpc.fromVpcAttributes(this, `${stackName}VPCImport`, {
      vpcId: vpcId,
      availabilityZones: [availabilityZones],
      privateSubnetIds: [
        getValueFromParameterStore(commonConfigs.vpcInfo.privateSubnetA, this),
        getValueFromParameterStore(commonConfigs.vpcInfo.privateSubnetB, this),
        getValueFromParameterStore(commonConfigs.vpcInfo.privateSubnetC, this),
      ]
    })


    //Some required imports
    const kms_key = kms.Key.fromKeyArn(this, "EncryptionKey",
      getValueFromParameterStore(commonConfigs.kms.arn, this))

    const prodDeployRole = iam.Role.fromRoleArn(this, "ProdDeployRole",
      getValueFromParameterStore(commonConfigs.roles.deployRole, this), { mutable: false })

    const crossAccountRole = iam.Role.fromRoleArn(this, "CrossAccountRole",
      getValueFromParameterStore(commonConfigs.roles.crossAccountRole, this), { mutable: false })

    const artifactBucket = s3.Bucket.fromBucketAttributes(this, `${stackName}ArtifactBucket`, {
      bucketName: getValueFromParameterStore(commonConfigs.artifactBucket, this),
      encryptionKey: kms_key,
    })
    const codeRepository = codeCommit.Repository.fromRepositoryName(this, `${commonConfigs.appName}Repository`,
      commonConfigs.codeRepo.name)

    const ecrRepoName = getValueFromParameterStore(commonConfigs.ecr, this)

    const nonProdEcrRepoURI = `${commonConfigs.account.nonProd}.dkr.ecr.${commonConfigs.account.region}.amazonaws.com/${ecrRepoName}`
    const prodEcrRepoURI = `${commonConfigs.account.prod}.dkr.ecr.${commonConfigs.account.region}.amazonaws.com/${ecrRepoName}`


    //Artifacts
    const sourceOut = new codepipeline.Artifact("sourceOut")
    const cdkBuildOut = new codepipeline.Artifact("cdkBuildOut")
    const lambdaBuildOut = new codepipeline.Artifact("lambdaBuildOut")
    const imageDefOut = new codepipeline.Artifact("imageDefOut")


    //CodeBuild Projects for build
    const cdkBuild = util.cdkBuildProject(this, `${stackName}CDKBuild`, cdkBuildOut.artifactName, vpc)

    //CodeBuild Projects for build
    const lambdaBuild = util.lambdaBuildProject(this, `${stackName}LambdaBuild`, lambdaBuildOut.artifactName, vpc)

    artifactBucket.grantReadWrite(cdkBuild)

    const dockerBuild = util.dockerBuildProject(this, `${stackName}DockerBuild`, imageDefOut.artifactName, vpc,
      commonConfigs, nonProdEcrRepoURI)

    //Stage to push docker image to prod
    const dockerPushProd = util.dockerPushProject(this, `${stackName}DockerPush`, vpc, commonConfigs, nonProdEcrRepoURI, prodEcrRepoURI)
    
    artifactBucket.grantReadWrite(dockerBuild)
    dockerBuild.role?.addManagedPolicy(iam.ManagedPolicy.fromAwsManagedPolicyName("AmazonEC2ContainerRegistryPowerUser"))
    dockerPushProd.role?.addManagedPolicy(iam.ManagedPolicy.fromAwsManagedPolicyName("AmazonEC2ContainerRegistryPowerUser"))

    artifactBucket.grantReadWrite(cdkBuild)

    //The below project can be used to force a new deployment in ECS if needed. Not used currently.
    /*
    const nonProdServiceUpdate = util.buildServiceUpdateProject("NonProd", commonConfigs.fargateService.name, vpc, this)
    const prodServiceUpdate = util.buildServiceUpdateProject("Prod", commonConfigs.fargateService.name, vpc, this)

    nonProdServiceUpdate.addToRolePolicy(util.buildServiceUpdatePolicy(commonConfigs.fargateService.name))
    prodServiceUpdate.addToRolePolicy(util.buildServiceUpdatePolicy(commonConfigs.fargateService.name))
    */


    //Pipeline
    const pipeline = new codepipeline.Pipeline(this, `${commonConfigs.appName}Pipeline`, {
      restartExecutionOnUpdate: true,
      artifactBucket: artifactBucket,
      crossAccountKeys: true,
      stages: [
        {
          stageName: "Source",
          actions: [
            new codepipeline_actions.CodeCommitSourceAction(
              {
                actionName: "Code_Commit_Pull",
                output: sourceOut,
                repository: codeRepository,
                branch: commonConfigs.codeRepo.defaultBranch,
              })
          ]

        },
        {
          stageName: "Build",
          actions: [
            new codepipeline_actions.CodeBuildAction({
              actionName: "CDK_Build",
              input: sourceOut,
              project: cdkBuild,
              outputs: [cdkBuildOut]

            }),
            new codepipeline_actions.CodeBuildAction({
              actionName: "Lambda_Build",
              input: sourceOut,
              project: lambdaBuild,
              outputs: [lambdaBuildOut]

            })
          ]
        },
        {
          stageName: "Pipeline_Update",
          actions: [
            new codepipeline_actions.CloudFormationCreateUpdateStackAction({
              actionName: "Self_Mutate",
              templatePath: cdkBuildOut.atPath(`${stackName}.template.json`),
              stackName: stackName,
              adminPermissions: true
            })
          ]
        },
        {
          stageName: "Application_Build",
          actions: [
            new codepipeline_actions.CodeBuildAction({
              actionName: "Docker_Build",
              input: sourceOut,
              project: dockerBuild,
              outputs: [imageDefOut],
              variablesNamespace: "DemoAPI"
            })
          ]
        },
        {
          stageName: "Non_Prod_Deployment",
          actions: [
            new codepipeline_actions.CloudFormationCreateUpdateStackAction({
              actionName: "Deploy_Non_Prod_Application_Stack",
              templatePath: cdkBuildOut.atPath(`${nonProdApplicationStack.stackName}.template.json`),
              stackName: nonProdApplicationStack.stackName,
              adminPermissions: true,
              parameterOverrides: {
                imageTag: "#{DemoAPI.SHA}",
                ...nonProdApplicationStack.lambdaCode.assign(lambdaBuildOut.s3Location)
              },
              extraInputs: [lambdaBuildOut]
            })
          ]
        },
        {
          stageName: "Approval",
          actions: [
            new codepipeline_actions.ManualApprovalAction({
              actionName: "Manual_Approval",
              // notifyEmails:"Emailhere".
            })
          ]
        },
        {
          stageName: "Push_Image",
          actions: [
            new codepipeline_actions.CodeBuildAction({
              actionName: "Image_Push_To_Prod",
              input: sourceOut,
              project: dockerPushProd,
              environmentVariables: {
                "SHA": {
                  value: "#{DemoAPI.SHA}"
                }
              }
            })
          ]
        },
        {
          stageName: "Prod_Deployment",
          actions: [
            new codepipeline_actions.CloudFormationCreateUpdateStackAction({
              actionName: "Deploy_Prod_Application_Stack",
              templatePath: cdkBuildOut.atPath(`${prodApplicationStack.stackName}.template.json`),
              stackName: prodApplicationStack.stackName,
              parameterOverrides: {
                imageTag: "#{DemoAPI.SHA}",
                ...prodApplicationStack.lambdaCode.assign(lambdaBuildOut.s3Location)
              },
              adminPermissions: true,
              role: crossAccountRole,
              deploymentRole: prodDeployRole
            })]
        }
      ]
    })


  }
}
