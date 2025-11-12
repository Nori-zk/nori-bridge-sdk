export async function getNewMinaLiteNetAccountSK(): Promise<string> {
    const rpcUrl = process?.env?.MINA_RPC_NETWORK_URL || 'http://localhost:8080/graphql';
    const url = new URL(rpcUrl);
    const host = url.hostname;
    
    const response = await fetch(`http://${host}:8181/acquire-account`);
    const data = await response.json();
    console.log(`Received new sk from acquire account.`);
    return data.sk;
}