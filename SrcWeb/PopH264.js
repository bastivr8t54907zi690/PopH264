import PromiseQueue from './PromiseQueue.js'

class DecoderBase
{
	constructor(Options)
	{
		this.DecodedFrameQueue = new PromiseQueue('WebcodecDecoder DecodedFrames');
	}
	
	async WaitForNextFrame()
	{
		return this.DecodedFrameQueue.WaitForNext();
	}
	
	PushData(H264Packet)
	{
		throw `PushData() not overloaded`;
	}
	
	OnFrame(Frame)
	{
		//	turn into an image/planes/meta
		this.DecodedFrameQueue.Push(Frame);
	}
	
	OnError(Error)
	{
		this.DecodedFrameQueue.Reject(Error);
	}
};


/*
	Decoder that uses webcodecs
*/
class WebcodecDecoder extends DecoderBase
{
	static Name()			{	return 'Webcodec';	}
	static IsSupported()	{	return VideoDecoder != undefined;	}

	constructor(Options={})
	{
		super(Options);
		
		const DecoderOptions = {};
		DecoderOptions.output = this.OnFrame.bind(this);
		DecoderOptions.error = this.OnError.bind(this);
		this.Decoder = new VideoDecoder( DecoderOptions );
		
		this.ConfigureDecoder();
		//this.TestEncoder();
	}
	
	ConfigureDecoder()
	{
		//	we try a few different codecs as we're having to guess support
		const CodecNames = this.GetCodecNames();
		const Errors = [];
		for ( let CodecName of CodecNames )
		{
			try
			{
				const Config = 
				{
					codec: CodecName,
					//	hints not required
					//codedWidth: 640,	
					//codedHeight: 480
				};
				//	configure and if doesn't throw, we've succeeded
				this.Decoder.configure(Config);
				return;
			}
			catch(e)
			{
				const Error = `${CodecName}:${e}`;
				Errors.push(Error);
			}
		}
		
		//	throw a collective error
		const Error = Errors.join('\n');
		throw Error;
	}
	
	async TestEncoder()
	{
		function OnChunk(Chunk)
		{
			console.log(`Chunk`,Chunk);
		}
		const Config = {
			codec: 'avc1.42E01E',
			width: 640,
			height: 480,
			bitrate: 8_000_000,     // 8 Mbps
			framerate: 30,
		};

		const Options = {};
		Options.error = console.error;
		Options.output = OnChunk;
		const Encoder = new VideoEncoder(Options);
		Encoder.configure(Config);
		
		const FrameImage = new ImageData(640,480);
		const Bitmap = await createImageBitmap(FrameImage);
		const Frame = new VideoFrame(Bitmap, { timestamp: 0 });

		Encoder.encode(Frame, { keyFrame: true });
		await Encoder.flush();
		console.log(`Encoder output`);
	}
	
	GetCodecNames()
	{
		const CodecNames = [];
		
		//	https://stackoverflow.com/questions/16363167/html5-video-tag-codecs-attribute
		//	codec needs more than just codec name
		//	gr: these are hex
		//	42,4D,64 = IDC in SPS
		//	01 = constraint flags
		//	1E = 30
		function IntToHexString(Integer)
		{
			return (Integer).toString(16).toUpperCase();
		}
		//	chromium constant names to aid googling
		const ProfileIntegers =
		{
			H264PROFILE_BASELINE:			66,
			H264PROFILE_MAIN:				77,
			H264PROFILE_SCALABLEBASELINE:	83,
			H264PROFILE_SCALABLEHIGH:		86,
			H264PROFILE_EXTENDED:			88,
			H264PROFILE_HIGH:				100,
			H264PROFILE_HIGH10PROFILE:		110,
			H264PROFILE_MULTIVIEWHIGH:		118,
			H264PROFILE_HIGH422PROFILE:		122,
			H264PROFILE_STEREOHIGH:			128,
			H264PROFILE_HIGH444PREDICTIVEPROFILE:	244,
		};

		const Profiles = Object.values(ProfileIntegers).map(IntToHexString);
	
		const Level30 = IntToHexString(30);	//	1E
		const Level40 = IntToHexString(40);	//	28
		
		
		//	constraints are bits
		const Constraints00 = '00';
		const Constraints01 = '01';	//	will fail, as bottom 3 bits are reserved
		const ConstraintsE0 = 'E0';
		const Baseline30 = `42${Constraints00}${Level30}`;//42E01E
		const Main30 = '4D401E';
		const High30 = '64001E';		
		
		//	codec string registry
		//	https://www.w3.org/TR/webcodecs-codec-registry/
		/*
		//	working on mac	
		CodecNames.push(`avc1.${High30}`);
		CodecNames.push(`avc1.${Main30}`);
		CodecNames.push(`avc1.${Baseline30}`);
		*/
		for ( let CodecName of ['avc1'] )
		{
			for ( let Profile of Profiles )
			{
				for ( let Constraint of [Constraints00] )
				{
					for ( let Level of [Level30,Level40] )
					{
						const Codec = `${CodecName}.${Profile}${Constraint}${Level}`;
						CodecNames.push(Codec);
						/*
						CodecNames.push(`avcC.${Baseline}${Constraints00}${Level30}`);
						CodecNames.push(`avcC.${Baseline}${Constraints00}${Level40}`);
						CodecNames.push(`avcC.${Main}00${Level30}`);
						CodecNames.push(`avcC.${Main}00${Level40}`);
						CodecNames.push(`avcC.${High}00${Level30}`);
						CodecNames.push(`avcC.${High}00${Level40}`);
						*/
					}
				}
			}
		}
		return CodecNames;
	}
	
	PushData(H264Packet,FrameTime)
	{
		if ( FrameTime === undefined )
			throw `Invalid packet FrameTime(${FrameTime})`;
			
		try
		{
			const Duration = 16;
			const IsKeyframe = false;
			
			const Packet = {};
			Packet.type = IsKeyframe ? 'key' : 'delta';
			Packet.timestamp = FrameTime;
			Packet.duration = Duration;
			Packet.data = H264Packet;
			const Chunk = new EncodedVideoChunk(Packet);
			this.Decoder.decode(Chunk);
		}
		catch(e)
		{
			this.OnError(e);
		}
	}
};


//	type factory
function GetDecoderType(DecoderName)
{
	const AnyDecoder = (DecoderName||'').length==0;
	
	if ( AnyDecoder || WebCodecsDecoder.Name() )
	{
		return WebcodecDecoder;
	}
	
	return null;
}


class DecoderParams
{
	constructor(Json={})
	{
		if ( typeof Json == typeof '' )
			Json = JSON.parse(Json);
		this.Options = Json;
	}
	
	get DecoderName()
	{
		const Name = this.Options.mDecoderName || this.Options.DecoderName;
		return Name || '';
	}

}


//	__export int32_t PopH264_CreateDecoder(const char* OptionsJson, char* ErrorBuffer, int32_t ErrorBufferLength)
export function CreateDecoder(Params={})
{
	Params = new DecoderParams(Params);
	
	const DecoderType = GetDecoderType(Params.DecoderName);
	if ( !DecoderType )
		throw `Unhandled decoder type ${Params.DecoderName}`;
		
	const Decoder = new DecoderType(Params);
	return Decoder;
}
	

//	PopH264_EnumDecoders
//	returns JSON of supported encoders and other meta
export function EnumDecoders()
{
	const DecoderNames = [];
	DecoderNames.push( WebcodecDecoder.Name() );
	
	const Decoders = {};
	Decoders.DecoderNames = DecoderNames;
	return Decoders;
}

//	__export int32_t			PopH264_GetTestData(const char* Name,uint8_t* Buffer,int32_t BufferSize);
export function GetTestData(Name)
{
	if ( Name == "RainbowGradient.h264" )
		return __PopH264Test_RainbowGradient_h264;
		
	throw `No test data named ${Name}`;
}


//	ffmpeg -i PopH264Test_GreyscaleGradient.png -pix_fmt yuvj420p -bf 0 -codec:v libx264 -profile:v baseline -level 3.0 -preset slow -f rawvideo PopH264Test_GreyscaleGradient.h264
//	xxd -i -a ./PopH264Test_GreyscaleGradient.h264
//const uint8_t __PopH264Test_RainbowGradient_h264[] = {
const __PopH264Test_RainbowGradient_h264 = new Uint8Array([
	0x00, 0x00, 0x00, 0x01, 0x67, 0x42, 0xc0, 0x1e, 0xd9, 0x86, 0x08, 0x69,
	0xb2, 0x00, 0x00, 0x03, 0x00, 0x02, 0x00, 0x00, 0x03, 0x00, 0x64, 0x1e,
	0x2c, 0x5c, 0xd0, 0x00, 0x00, 0x00, 0x01, 0x68, 0xc9, 0x60, 0xf2, 0xc8,
	0x00, 0x00, 0x01, 0x06, 0x05, 0xff, 0xff, 0x6d, 0xdc, 0x45, 0xe9, 0xbd,
	0xe6, 0xd9, 0x48, 0xb7, 0x96, 0x2c, 0xd8, 0x20, 0xd9, 0x23, 0xee, 0xef,
	0x78, 0x32, 0x36, 0x34, 0x20, 0x2d, 0x20, 0x63, 0x6f, 0x72, 0x65, 0x20,
	0x31, 0x35, 0x35, 0x20, 0x72, 0x32, 0x39, 0x31, 0x37, 0x20, 0x30, 0x61,
	0x38, 0x34, 0x64, 0x39, 0x38, 0x20, 0x2d, 0x20, 0x48, 0x2e, 0x32, 0x36,
	0x34, 0x2f, 0x4d, 0x50, 0x45, 0x47, 0x2d, 0x34, 0x20, 0x41, 0x56, 0x43,
	0x20, 0x63, 0x6f, 0x64, 0x65, 0x63, 0x20, 0x2d, 0x20, 0x43, 0x6f, 0x70,
	0x79, 0x6c, 0x65, 0x66, 0x74, 0x20, 0x32, 0x30, 0x30, 0x33, 0x2d, 0x32,
	0x30, 0x31, 0x38, 0x20, 0x2d, 0x20, 0x68, 0x74, 0x74, 0x70, 0x3a, 0x2f,
	0x2f, 0x77, 0x77, 0x77, 0x2e, 0x76, 0x69, 0x64, 0x65, 0x6f, 0x6c, 0x61,
	0x6e, 0x2e, 0x6f, 0x72, 0x67, 0x2f, 0x78, 0x32, 0x36, 0x34, 0x2e, 0x68,
	0x74, 0x6d, 0x6c, 0x20, 0x2d, 0x20, 0x6f, 0x70, 0x74, 0x69, 0x6f, 0x6e,
	0x73, 0x3a, 0x20, 0x63, 0x61, 0x62, 0x61, 0x63, 0x3d, 0x30, 0x20, 0x72,
	0x65, 0x66, 0x3d, 0x35, 0x20, 0x64, 0x65, 0x62, 0x6c, 0x6f, 0x63, 0x6b,
	0x3d, 0x31, 0x3a, 0x30, 0x3a, 0x30, 0x20, 0x61, 0x6e, 0x61, 0x6c, 0x79,
	0x73, 0x65, 0x3d, 0x30, 0x78, 0x31, 0x3a, 0x30, 0x78, 0x31, 0x31, 0x31,
	0x20, 0x6d, 0x65, 0x3d, 0x68, 0x65, 0x78, 0x20, 0x73, 0x75, 0x62, 0x6d,
	0x65, 0x3d, 0x38, 0x20, 0x70, 0x73, 0x79, 0x3d, 0x31, 0x20, 0x70, 0x73,
	0x79, 0x5f, 0x72, 0x64, 0x3d, 0x31, 0x2e, 0x30, 0x30, 0x3a, 0x30, 0x2e,
	0x30, 0x30, 0x20, 0x6d, 0x69, 0x78, 0x65, 0x64, 0x5f, 0x72, 0x65, 0x66,
	0x3d, 0x31, 0x20, 0x6d, 0x65, 0x5f, 0x72, 0x61, 0x6e, 0x67, 0x65, 0x3d,
	0x31, 0x36, 0x20, 0x63, 0x68, 0x72, 0x6f, 0x6d, 0x61, 0x5f, 0x6d, 0x65,
	0x3d, 0x31, 0x20, 0x74, 0x72, 0x65, 0x6c, 0x6c, 0x69, 0x73, 0x3d, 0x32,
	0x20, 0x38, 0x78, 0x38, 0x64, 0x63, 0x74, 0x3d, 0x30, 0x20, 0x63, 0x71,
	0x6d, 0x3d, 0x30, 0x20, 0x64, 0x65, 0x61, 0x64, 0x7a, 0x6f, 0x6e, 0x65,
	0x3d, 0x32, 0x31, 0x2c, 0x31, 0x31, 0x20, 0x66, 0x61, 0x73, 0x74, 0x5f,
	0x70, 0x73, 0x6b, 0x69, 0x70, 0x3d, 0x31, 0x20, 0x63, 0x68, 0x72, 0x6f,
	0x6d, 0x61, 0x5f, 0x71, 0x70, 0x5f, 0x6f, 0x66, 0x66, 0x73, 0x65, 0x74,
	0x3d, 0x2d, 0x32, 0x20, 0x74, 0x68, 0x72, 0x65, 0x61, 0x64, 0x73, 0x3d,
	0x36, 0x20, 0x6c, 0x6f, 0x6f, 0x6b, 0x61, 0x68, 0x65, 0x61, 0x64, 0x5f,
	0x74, 0x68, 0x72, 0x65, 0x61, 0x64, 0x73, 0x3d, 0x31, 0x20, 0x73, 0x6c,
	0x69, 0x63, 0x65, 0x64, 0x5f, 0x74, 0x68, 0x72, 0x65, 0x61, 0x64, 0x73,
	0x3d, 0x30, 0x20, 0x6e, 0x72, 0x3d, 0x30, 0x20, 0x64, 0x65, 0x63, 0x69,
	0x6d, 0x61, 0x74, 0x65, 0x3d, 0x31, 0x20, 0x69, 0x6e, 0x74, 0x65, 0x72,
	0x6c, 0x61, 0x63, 0x65, 0x64, 0x3d, 0x30, 0x20, 0x62, 0x6c, 0x75, 0x72,
	0x61, 0x79, 0x5f, 0x63, 0x6f, 0x6d, 0x70, 0x61, 0x74, 0x3d, 0x30, 0x20,
	0x63, 0x6f, 0x6e, 0x73, 0x74, 0x72, 0x61, 0x69, 0x6e, 0x65, 0x64, 0x5f,
	0x69, 0x6e, 0x74, 0x72, 0x61, 0x3d, 0x30, 0x20, 0x62, 0x66, 0x72, 0x61,
	0x6d, 0x65, 0x73, 0x3d, 0x30, 0x20, 0x77, 0x65, 0x69, 0x67, 0x68, 0x74,
	0x70, 0x3d, 0x30, 0x20, 0x6b, 0x65, 0x79, 0x69, 0x6e, 0x74, 0x3d, 0x32,
	0x35, 0x30, 0x20, 0x6b, 0x65, 0x79, 0x69, 0x6e, 0x74, 0x5f, 0x6d, 0x69,
	0x6e, 0x3d, 0x32, 0x35, 0x20, 0x73, 0x63, 0x65, 0x6e, 0x65, 0x63, 0x75,
	0x74, 0x3d, 0x34, 0x30, 0x20, 0x69, 0x6e, 0x74, 0x72, 0x61, 0x5f, 0x72,
	0x65, 0x66, 0x72, 0x65, 0x73, 0x68, 0x3d, 0x30, 0x20, 0x72, 0x63, 0x5f,
	0x6c, 0x6f, 0x6f, 0x6b, 0x61, 0x68, 0x65, 0x61, 0x64, 0x3d, 0x35, 0x30,
	0x20, 0x72, 0x63, 0x3d, 0x63, 0x72, 0x66, 0x20, 0x6d, 0x62, 0x74, 0x72,
	0x65, 0x65, 0x3d, 0x31, 0x20, 0x63, 0x72, 0x66, 0x3d, 0x32, 0x33, 0x2e,
	0x30, 0x20, 0x71, 0x63, 0x6f, 0x6d, 0x70, 0x3d, 0x30, 0x2e, 0x36, 0x30,
	0x20, 0x71, 0x70, 0x6d, 0x69, 0x6e, 0x3d, 0x30, 0x20, 0x71, 0x70, 0x6d,
	0x61, 0x78, 0x3d, 0x36, 0x39, 0x20, 0x71, 0x70, 0x73, 0x74, 0x65, 0x70,
	0x3d, 0x34, 0x20, 0x69, 0x70, 0x5f, 0x72, 0x61, 0x74, 0x69, 0x6f, 0x3d,
	0x31, 0x2e, 0x34, 0x30, 0x20, 0x61, 0x71, 0x3d, 0x31, 0x3a, 0x31, 0x2e,
	0x30, 0x30, 0x00, 0x80, 0x00, 0x00, 0x01, 0x65, 0x88, 0x84, 0x27, 0x11,
	0x81, 0xd3, 0x00, 0x01, 0x06, 0xb6, 0x43, 0x00, 0x00, 0x40, 0xc5, 0x09,
	0x00, 0x01, 0x0b, 0xc4, 0x23, 0x06, 0x40, 0x00, 0x45, 0xf9, 0x90, 0xd0,
	0x00, 0x10, 0x6d, 0x43, 0x80, 0x00, 0x84, 0xfc, 0x44, 0xa2, 0x40, 0x00,
	0x43, 0x7f, 0x04, 0x40, 0x00, 0x41, 0x29, 0x08, 0x80, 0x00, 0x87, 0xda,
	0x11, 0x20, 0x1e, 0x40, 0x00, 0x20, 0x3c, 0xc8, 0x70, 0x00, 0x10, 0xbe,
	0x88, 0x80, 0x03, 0x42, 0x30, 0x6a, 0x00, 0x02, 0x2f, 0x2c, 0x84, 0x80,
	0x00, 0x83, 0x62, 0x1c, 0x00, 0x04, 0x27, 0xa2, 0x25, 0x0a, 0x00, 0x00,
	0x86, 0xd3, 0x21, 0x20, 0x00, 0x20, 0x9a, 0x84, 0x80, 0x00, 0x87, 0xc2,
	0x34, 0x80, 0x74, 0xc0, 0x26, 0x43, 0x05, 0x09, 0x1a, 0x33, 0x83, 0x26,
	0xc8, 0x6d, 0x09, 0x0d, 0x19, 0x9c, 0xd8, 0x22, 0x02, 0x5c, 0x43, 0x30,
	0x1e, 0x44, 0xc8, 0x69, 0x42, 0x22, 0x46, 0x70, 0x6a, 0x4c, 0x86, 0x28,
	0x44, 0x12, 0x33, 0x28, 0x51, 0x64, 0x24, 0x1a, 0xa6, 0x90, 0x0e, 0x98,
	0x09, 0x90, 0xc0, 0x14, 0x30, 0x14, 0x67, 0x06, 0x43, 0x64, 0x36, 0x84,
	0x86, 0x8c, 0xce, 0x24, 0xe0, 0x88, 0x09, 0x73, 0xb3, 0x01, 0xe2, 0xac,
	0x86, 0x94, 0x34, 0x28, 0xce, 0x0d, 0x44, 0xcb, 0x88, 0x84, 0x8c, 0xce,
	0x5c, 0x12, 0x03, 0x54, 0xd3, 0x01, 0xd3, 0x01, 0x32, 0x18, 0x28, 0x60,
	0x28, 0xce, 0x0c, 0x8d, 0x90, 0xda, 0x12, 0x1a, 0x33, 0x28, 0x9e, 0x08,
	0x81, 0x21, 0x8a, 0x33, 0x20, 0x1e, 0x40, 0x36, 0x43, 0x42, 0x86, 0x85,
	0x19, 0xc1, 0xa8, 0x99, 0x0c, 0x14, 0x22, 0x12, 0x14, 0xce, 0x20, 0x70,
	0x48, 0x0d, 0x0f, 0xa6, 0x9f, 0xe6, 0x98, 0x0e, 0x98, 0x04, 0xc8, 0x60,
	0x28, 0x48, 0x68, 0xce, 0x0c, 0x8d, 0x91, 0x90, 0x90, 0xd1, 0x99, 0x42,
	0xf6, 0x42, 0x20, 0x49, 0x33, 0x20, 0x1e, 0x40, 0x1b, 0x21, 0xa5, 0x08,
	0x84, 0x8c, 0xe0, 0xd4, 0x4c, 0x86, 0x28, 0x44, 0x24, 0x29, 0x9c, 0x40,
	0xe0, 0x90, 0x1a, 0xba, 0x69, 0xf9, 0xa6, 0x03, 0xa6, 0x02, 0x64, 0x30,
	0x14, 0x30, 0x14, 0x67, 0x06, 0x46, 0xc8, 0x6d, 0x09, 0x0d, 0x19, 0x94,
	0xd8, 0x22, 0x04, 0xb9, 0x99, 0x00, 0xf2, 0x01, 0xb2, 0x1a, 0x50, 0x88,
	0x91, 0x9c, 0x1a, 0x93, 0x21, 0x8a, 0x11, 0x09, 0x19, 0x94, 0x43, 0x82,
	0x41, 0xaa, 0x69, 0x00, 0xe9, 0x80, 0x4c, 0x86, 0x0a, 0x18, 0x0a, 0x33,
	0x83, 0x26, 0xc8, 0x7c, 0x48, 0x68, 0xcc, 0xa2, 0x4e, 0x08, 0x81, 0x21,
	0x8a, 0x33, 0x20, 0x1e, 0x40, 0x36, 0x43, 0x42, 0x86, 0x85, 0x19, 0xc1,
	0xa8, 0x4c, 0xb8, 0x88, 0x91, 0x99, 0x42, 0x8b, 0x21, 0x20, 0xd0, 0xf9,
	0xa4, 0x03, 0xa6, 0x02, 0x64, 0x30, 0x14, 0x24, 0x34, 0x67, 0x06, 0x46,
	0xc8, 0x6d, 0x09, 0x0d, 0x19, 0x9c, 0x49, 0xc1, 0x10, 0x12, 0x4c, 0xcc,
	0x07, 0x90, 0x06, 0xc8, 0x69, 0x43, 0x42, 0x8c, 0xe0, 0xd4, 0x99, 0x0c,
	0x14, 0x22, 0x12, 0x33, 0x29, 0x70, 0x48, 0x0d, 0x53, 0x48, 0x07, 0x4c,
	0x04, 0xc8, 0x60, 0xa1, 0x80, 0xa3, 0x38, 0x32, 0x36, 0x43, 0x68, 0x48,
	0x68, 0xcc, 0xe2, 0x4e, 0x08, 0x80, 0x97, 0x33, 0x30, 0x1e, 0x40, 0x36,
	0x43, 0x4a, 0x11, 0x09, 0x19, 0x94, 0x1a, 0x84, 0xc8, 0x62, 0x84, 0x40,
	0x91, 0x9c, 0x40, 0xe0, 0x90, 0x35, 0x4d, 0x20, 0x1d, 0x30, 0x09, 0x90,
	0xc0, 0x14, 0x30, 0x14, 0x67, 0x06, 0x46, 0xc8, 0x6d, 0x09, 0x0d, 0x19,
	0x94, 0x4f, 0x04, 0x40, 0x97, 0x33, 0x20, 0x1e, 0x40, 0x1b, 0x21, 0xa1,
	0x42, 0x22, 0x46, 0x70, 0x6a, 0x26, 0x5c, 0x44, 0x24, 0x66, 0x71, 0x03,
	0x82, 0x40, 0xd0, 0xf9, 0xa6, 0x03, 0xa6, 0x02, 0x64, 0x30, 0x50, 0xc0,
	0x14, 0x21, 0xc1, 0x9d, 0x90, 0xda, 0x12, 0x1a, 0x33, 0x28, 0x5e, 0xc8,
	0x44, 0x09, 0x0c, 0x51, 0x99, 0x00, 0xf2, 0x01, 0xb2, 0x1a, 0x50, 0xd2,
	0x8c, 0xe0, 0xd4, 0x99, 0x0c, 0x14, 0x22, 0x12, 0x18, 0xce, 0x20, 0xe0,
	0x90, 0x1a, 0xa9, 0xa7, 0xf9, 0xa6, 0x03, 0xa6, 0x01, 0x32, 0x18, 0x0a,
	0x18, 0x02, 0x8c, 0xe0, 0xc9, 0xb2, 0xa2, 0x43, 0x42, 0x19, 0x5a, 0x11,
	0x02, 0x49, 0x99, 0x00, 0xf1, 0x0e, 0xc8, 0x69, 0x42, 0x21, 0x23, 0x32,
	0x83, 0x50, 0x99, 0x0c, 0x50, 0x88, 0x12, 0x14, 0xe2, 0x1c, 0x12, 0x03,
	0x55, 0x34, 0xff, 0x34, 0x80, 0x74, 0xc0, 0x4c, 0x86, 0x02, 0x86, 0x02,
	0x8c, 0xe0, 0xc8, 0xd9, 0x0d, 0x28, 0x48, 0x68, 0xcc, 0xa6, 0xc1, 0x10,
	0x25, 0xcc, 0xc8, 0x07, 0x90, 0x1b, 0x21, 0xa5, 0x08, 0x89, 0x19, 0xc1,
	0xa8, 0x99, 0x0e, 0xc4, 0x41, 0x23, 0x32, 0x85, 0x16, 0x42, 0x41, 0xaa,
	0x69, 0x00, 0xe9, 0x80, 0x99, 0x0c, 0x14, 0x30, 0x05, 0x19, 0xc1, 0x91,
	0xb2, 0xa2, 0x43, 0x46, 0x67, 0x12, 0x70, 0x44, 0x04, 0x87, 0x66, 0x66,
	0x03, 0xc8, 0x03, 0x64, 0x34, 0x28, 0x69, 0x46, 0x70, 0x6a, 0x26, 0x43,
	0x14, 0x22, 0x24, 0x66, 0x52, 0xe0, 0x90, 0x1a, 0x1f, 0x34, 0x80, 0x74,
	0xc0, 0x26, 0x43, 0x01, 0x43, 0x00, 0x51, 0x9c, 0x19, 0x1b, 0x21, 0xb4,
	0x24, 0x34, 0x66, 0x51, 0x3c, 0x11, 0x02, 0x5c, 0xcc, 0x80, 0x79, 0x00,
	0x6c, 0x86, 0x94, 0x22, 0x12, 0x33, 0x83, 0x51, 0x32, 0x18, 0xa1, 0x10,
	0x48, 0xcc, 0xa2, 0x07, 0x04, 0x83, 0x54, 0xd2, 0x01, 0xd3, 0x01, 0x32,
	0x18, 0x0a, 0x18, 0x0a, 0x33, 0x83, 0x26, 0xc8, 0x6d, 0x09, 0x0d, 0x19,
	0x94, 0x4f, 0x04, 0x40, 0x97, 0x33, 0x20, 0x30, 0x81, 0xb2, 0x1a, 0x50,
	0x88, 0x91, 0x99, 0x42, 0xe5, 0x90, 0xc1, 0x42, 0x21, 0x28, 0x7f, 0x86,
	0x01, 0xb0, 0x5a, 0x14, 0x01, 0xe6, 0x47, 0x2d, 0xf1, 0x00, 0x51, 0x08,
	0x00, 0x07, 0x80, 0x75, 0x89, 0x1d, 0x12, 0x3b, 0x83, 0x90, 0x05, 0xa0,
	0xe4, 0x01, 0x6c
]);