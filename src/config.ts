import "dotenv/config";

type ConfigType={
    port:number,
    tgBotToken:string
}
type UnvalidatedConfigType={
    port:unknown,
    tgBotToken:unknown
}
type ValidatedConfigType={
    port:string,
    tgBotToken:string
}
function createConfig():ConfigType{
    const config:UnvalidatedConfigType={
        port:process.env.PORT,
        tgBotToken:process.env.TG_BOT_TOKEN
    };
    if(validateConfig(config))
    {
        const typedConfig:ConfigType={
            ...config,
            port:parseInt(config.port,10)
        }
        return typedConfig;
    }
    throw Error("Env doesnt contain nessesary variables");
}
function validateConfig(config:UnvalidatedConfigType):config is ValidatedConfigType{
    if(typeof config.port!=='string'||Number.isNaN(parseInt(config.port,10)))
        return false;
    if(typeof config.tgBotToken!=='string'||config.tgBotToken.trim()==="")
        return false;
    return true;

}
export const EnvConfig=createConfig()